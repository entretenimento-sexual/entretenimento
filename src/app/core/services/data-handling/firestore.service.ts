// src/app/core/services/autentication/firestore.service.ts
import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Firestore, collection, doc, query, collectionData, QueryConstraint,
         setDoc, updateDoc, deleteDoc, increment, WithFieldValue, DocumentData,  getDocs,
         where,  getDoc } from '@angular/fire/firestore';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private firestore = inject(Firestore);
  private injector = inject(Injector);

  constructor(
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreErrorHandler: FirestoreErrorHandlerService,
    private cacheService: CacheService
  ) { }

  getFirestoreInstance(): Firestore {
    return this.firestore;
  }

  getDocument<T>(collectionName: string, docId: string): Observable<T | null> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(getDoc(docRef)).pipe(
      switchMap(docSnap => of(docSnap.exists() ? (docSnap.data() as T) : null)),
      catchError(error => this.handleFirestoreError(error))
    );
  }

  getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    useCache = true,
    cacheTTL = 300000
  ): Observable<T[]> {
    const cacheKey = `${collectionName}:${JSON.stringify(constraints)}`;

    return (useCache ? this.cacheService.get<T[]>(cacheKey) : of(null)).pipe(
      switchMap(cachedData => {
        if (cachedData) return of(cachedData);

        const collectionRef = collection(this.firestore, collectionName);
        const q = query(collectionRef, ...constraints);

        return runInInjectionContext(this.injector, () =>  // 👈 Usando o Injector corretamente
          collectionData(q, { idField: 'id' })
        ).pipe(
          switchMap(data => of(data as T[])),
          tap(data => useCache && this.cacheService.set(cacheKey, data)),
          catchError(error => this.handleFirestoreError(error))
        );
      })
    );
  }

  addDocument<T extends WithFieldValue<DocumentData>>(collectionName: string, data: T): Observable<void> {
    const colRef = collection(this.firestore, collectionName);
    const docRef = doc(colRef);
    return from(setDoc(docRef, data)).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  updateDocument(collectionName: string, docId: string, data: Partial<any>): Observable<void> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(updateDoc(docRef, data)).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  deleteDocument(collectionName: string, docId: string): Observable<void> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(deleteDoc(docRef)).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  incrementField(collectionName: string, docId: string, fieldName: string, incrementBy: number): Observable<void> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(updateDoc(docRef, { [fieldName]: increment(incrementBy) })).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  checkIfEmailExists(email: string): Observable<boolean> {
    const userCol = collection(this.firestore, 'users');
    const q = query(userCol, where('email', '==', email.trim()));
    return from(getDocs(q)).pipe(
      switchMap(snapshot => of(snapshot.size > 0)),
      catchError(error => this.firestoreErrorHandler.handleFirestoreError(error))
    );
  }

  saveInitialUserData(uid: string, userData: IUserRegistrationData): Observable<void> {
    if (userData.municipio && userData.estado) {
      userData.municipioEstado = `${userData.municipio} - ${userData.estado}`;
    }

    const userRef = doc(this.firestore, 'users', uid);
    return from(setDoc(userRef, userData, { merge: true })).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  private handleFirestoreError(error: any): Observable<never> {
    this.globalErrorHandler.handleError(error);
    return throwError(() => error);
  }

  private setUndefinedValuesToNull(data: any) {
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) data[key] = null;
    });
    return data;
  }
}
