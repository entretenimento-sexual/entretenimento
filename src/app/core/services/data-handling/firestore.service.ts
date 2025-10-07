// src/app/core/services/data-handling/firestore.service.ts
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

import {
  Firestore,
  collection, doc, query, type QueryConstraint,
  setDoc, updateDoc, deleteDoc, increment,
  getDocs, where, getDoc, arrayUnion,
  Timestamp, collectionData, type DocumentData
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import type { WithFieldValue } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  constructor(
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreErrorHandler: FirestoreErrorHandlerService,
    private cacheService: CacheService,
    private injector: Injector,
    private db: Firestore,
    private auth: Auth,
  ) { }

  /** Helper: garante *Injection Context* para chamadas AngularFire */
  private afRun<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getFirestoreInstance(): Firestore { return this.db; }

  getPublicNicknameIndex(nickname: string): Observable<any | null> {
    const normalized = nickname.trim().toLowerCase();
    const docId = `nickname:${normalized}`;
    return this.getDocument<any>('public_index', docId);
  }

  checkNicknameIndexExists(nickname: string): Observable<boolean> {
    return this.getPublicNicknameIndex(nickname).pipe(map(doc => !!doc));
  }

  /** 🔎 GET por ID — agora dentro do Injection Context */
  getDocument<T>(collectionName: string, docId: string): Observable<T | null> {
    return this.afRun(() => {
      const ref = doc(this.db, collectionName, docId);
      return from(getDoc(ref)).pipe(
        map(snap => (snap.exists() ? (snap.data() as T) : null)),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  /** 📋 GET lista — já estava correto, só padronizei com afRun */
  getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    useCache = true,
    cacheTTL = 5 * 60 * 1000
  ): Observable<T[]> {
    const cacheKey = `${collectionName}:${JSON.stringify(constraints)}`;
    return (useCache ? this.cacheService.get<T[]>(cacheKey) : of(null)).pipe(
      switchMap(cached =>
        cached
          ? of(cached)
          : this.afRun(() => {
            const colRef = collection(this.db, collectionName);
            const q = query(colRef, ...constraints);
            return collectionData(q as any, { idField: 'id' }).pipe(
              tap(data => useCache && this.cacheService.set(cacheKey, data, cacheTTL)),
              map(data => data as T[])
            );
          })
      ),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** ➕ ADD — dentro do Injection Context */
  addDocument<T extends WithFieldValue<DocumentData>>(collectionName: string, data: T): Observable<void> {
    return this.afRun(() => {
      const colRef = collection(this.db, collectionName);
      return from(setDoc(doc(colRef), data)).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  /** 📝 Atualiza documento parcial (com Injection Context) */
  updateDocument(collectionName: string, docId: string, data: Partial<any>): Observable<void> {
    return runInInjectionContext(this.injector, () =>
      from(updateDoc(doc(this.db, collectionName, docId), data)).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      )
    );
  }

  /** 🗑️ DELETE — dentro do Injection Context */
  deleteDocument(collectionName: string, docId: string): Observable<void> {
    return this.afRun(() => {
      const ref = doc(this.db, collectionName, docId);
      return from(deleteDoc(ref)).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  /** 🔢 INCREMENT — dentro do Injection Context */
  incrementField(collectionName: string, docId: string, fieldName: string, incBy: number): Observable<void> {
    return this.afRun(() => {
      const ref = doc(this.db, collectionName, docId);
      return from(updateDoc(ref, { [fieldName]: increment(incBy) })).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  checkIfEmailExists(email: string): Observable<boolean> {
    return this.afRun(() => {
      const qCol = query(collection(this.db, 'users'), where('email', '==', email.trim()));
      return from(getDocs(qCol)).pipe(
        map(snapshot => snapshot.size > 0),
        catchError(err => this.firestoreErrorHandler.handleFirestoreError(err))
      );
    });
  }

  saveInitialUserData(uid: string, data: IUserRegistrationData): Observable<void> {
    if ((data as any).municipio && (data as any).estado) {
      (data as any).municipioEstado = `${(data as any).municipio} - ${(data as any).estado}`;
    }
    return this.afRun(() => {
      const userRef = doc(this.db, 'users', uid);
      const nicknameHistory = [{ nickname: data.nickname.trim().toLowerCase(), date: Timestamp.now() }];
      return from(setDoc(userRef, { ...data, nicknameHistory: arrayUnion(...nicknameHistory) }, { merge: true })).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  savePublicIndexNickname(nickname: string): Observable<void> {
    return this.afRun(() => {
      const normalized = nickname.trim().toLowerCase();
      const docId = `nickname:${normalized}`;
      const data = {
        type: 'nickname',
        value: normalized,
        uid: this.auth.currentUser?.uid ?? null,
        createdAt: Timestamp.now(),
        lastChangedAt: Timestamp.now()
      };
      return from(setDoc(doc(this.db, 'public_index', docId), data)).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  updatePublicNickname(oldNickname: string, newNickname: string, isSubscriber: boolean): Observable<void> {
    if (!this.auth.currentUser) return throwError(() => new Error('Usuário não autenticado.'));
    if (!isSubscriber) return throwError(() => new Error('Mudança de apelido restrita a assinantes.'));

    return this.afRun(() => {
      const newDocId = `nickname:${newNickname.trim().toLowerCase()}`;
      const oldDocId = `nickname:${oldNickname.trim().toLowerCase()}`;
      const newDocRef = doc(this.db, 'public_index', newDocId);
      const oldDocRef = doc(this.db, 'public_index', oldDocId);

      return from(getDoc(newDocRef)).pipe(
        switchMap(snap => {
          if (snap.exists()) return throwError(() => new Error('Novo apelido já está em uso.'));
          return from(deleteDoc(oldDocRef)).pipe(
            switchMap(() =>
              setDoc(newDocRef, {
                type: 'nickname',
                value: newNickname.toLowerCase(),
                uid: this.auth.currentUser!.uid,
                createdAt: Timestamp.now(),
                lastChangedAt: Timestamp.now()
              })
            )
          );
        }),
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  private handleFirestoreError(error: any): Observable<never> {
    this.globalErrorHandler.handleError(error);
    return throwError(() => error);
  }
}
