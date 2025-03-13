// src/app/core/services/autentication/firestore.service.ts
import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, increment, QueryConstraint, WithFieldValue, DocumentData } from '@angular/fire/firestore'; // ✅ Correto
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data'; // ✅ Importação correta

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {

  constructor(private firestore: Firestore,
              private globalErrorHandler: GlobalErrorHandlerService,
              private firestoreErrorHandler: FirestoreErrorHandlerService,
              private cacheService: CacheService,) { }

  // ✅ **Retorna a instância do Firestore**
  getFirestoreInstance(): Firestore {
    return this.firestore;
  }

  // ✅ **Busca um único documento no Firestore**
  getDocument<T>(collectionName: string, docId: string): Observable<T | null> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(getDoc(docRef)).pipe(
      map(docSnap => docSnap.exists() ? (docSnap.data() as T) : null),
      catchError(error => this.handleFirestoreError(error))
    );
  }

  // ✅ **Busca múltiplos documentos no Firestore**
  getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    useCache: boolean = true,
    cacheTTL: number = 300000
  ): Observable<T[]> {
    const cacheKey = `${collectionName}:${JSON.stringify(constraints)}`;

    return (useCache ? this.cacheService.get<T[]>(cacheKey) : of(null)).pipe(
      switchMap(cachedData => {
        if (cachedData) {
          console.log(`[FirestoreService] Dados encontrados no cache: ${cacheKey}`);
          return of(cachedData);
        }

        const collectionRef = collection(this.firestore, collectionName);
        const q = query(collectionRef, ...constraints);

        return from(getDocs(q)).pipe(
          map((querySnapshot) => {
            const data = querySnapshot.docs.map(doc => doc.data() as T);
            if (useCache) this.cacheService.set(cacheKey, data, cacheTTL);
            return data;
          }),
          catchError(error => this.firestoreErrorHandler.handleFirestoreError(error))
        );
      }),
      shareReplay(1)
    );
  }


  // ✅ **Verifica se um e-mail já está registrado**
  checkIfEmailExists(email: string): Observable<boolean> {
    const userCollection = collection(this.firestore, 'users');
    const q = query(userCollection, where('email', '==', email.trim()));

    return from(getDocs(q)).pipe(
      map(querySnapshot => querySnapshot.size > 0),
      catchError(error => this.firestoreErrorHandler.handleFirestoreError(error))
    );
  }

  // ✅ **Salva os dados iniciais do usuário após o registro**
  saveInitialUserData(uid: string, userData: IUserRegistrationData): Observable<void> {
    if (userData.municipio && userData.estado) {
      userData.municipioEstado = `${userData.municipio} - ${userData.estado}`;
    }

    const userRef = doc(this.firestore, 'users', uid);
    return from(setDoc(userRef, { ...userData }, { merge: true })).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  // ✅ **Incrementa um campo no Firestore**
  incrementField(collectionName: string, docId: string, fieldName: string, incrementBy: number): Observable<void> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(updateDoc(docRef, { [fieldName]: increment(incrementBy) })).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  // ✅ **Atualiza um documento no Firestore**
  updateDocument(collectionName: string, docId: string, data: Partial<any>): Observable<void> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(updateDoc(docRef, data)).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  // ✅ **Deleta um documento do Firestore**
  deleteDocument(collectionName: string, docId: string): Observable<void> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(deleteDoc(docRef)).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  // ✅ **Adiciona um documento a uma coleção no Firestore**
  addDocument<T extends WithFieldValue<DocumentData>>(collectionName: string, data: T): Observable<void> {
    const docRef = doc(collection(this.firestore, collectionName));
    return from(setDoc(docRef, data)).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }

  // ✅ **Centraliza o tratamento de erros do Firestore**
  private handleFirestoreError(error: any): Observable<never> {
    this.globalErrorHandler.handleError(error);
    return throwError(() => error);
  }
}
