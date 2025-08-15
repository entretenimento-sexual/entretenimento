// src\app\core\services\data-handling\firestore.service.ts
import { Inject, Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
          Firestore, collection, doc, query, collectionData, QueryConstraint,
          setDoc, updateDoc, deleteDoc, increment, WithFieldValue, DocumentData,
          getDocs, where, getDoc, arrayUnion
        } from '@angular/fire/firestore';
import { Timestamp } from 'firebase/firestore';
import { getAuth, User } from 'firebase/auth';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {

  constructor(
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreErrorHandler: FirestoreErrorHandlerService,
    private cacheService: CacheService,
    private injector: Injector,
    @Inject(Firestore) private firestore: Firestore
  ) { }

  /** 🔍 Retorna instância do Firestore */
  getFirestoreInstance(): Firestore {
    return this.firestore;
  }

  /** 🔍 Busca documento por ID */
  getDocument<T>(collectionName: string, docId: string): Observable<T | null> {
    const docRef = doc(this.firestore, collectionName, docId);
    return from(getDoc(docRef)).pipe(
      map(docSnap => docSnap.exists() ? (docSnap.data() as T) : null),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 📋 Busca múltiplos documentos com cache opcional */
  getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    useCache = true,
    cacheTTL = 5 * 60 * 1000 // 5 minutos
  ): Observable<T[]> {
    const cacheKey = `${collectionName}:${JSON.stringify(constraints)}`;
    return (useCache ? this.cacheService.get<T[]>(cacheKey) : of(null)).pipe(
      switchMap(cached => cached
        ? of(cached)
        : runInInjectionContext(this.injector, () => {
          const colRef = collection(this.firestore, collectionName);
          const q = query(colRef, ...constraints);
          return collectionData(q, { idField: 'id' }).pipe(
            tap(data => useCache && this.cacheService.set(cacheKey, data, cacheTTL)),
            map(data => data as T[])
          );
        })
      ),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** ➕ Adiciona documento com ID automático */
  addDocument<T extends WithFieldValue<DocumentData>>(collectionName: string, data: T): Observable<void> {
    const colRef = collection(this.firestore, collectionName);
    return from(setDoc(doc(colRef), data)).pipe(
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 📝 Atualiza documento parcial */
  updateDocument(collectionName: string, docId: string, data: Partial<any>): Observable<void> {
    return from(updateDoc(doc(this.firestore, collectionName, docId), data)).pipe(
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 🗑️ Deleta documento */
  deleteDocument(collectionName: string, docId: string): Observable<void> {
    return from(deleteDoc(doc(this.firestore, collectionName, docId))).pipe(
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 🔢 Incrementa campo numérico */
  incrementField(collectionName: string, docId: string, fieldName: string, incrementBy: number): Observable<void> {
    return from(updateDoc(doc(this.firestore, collectionName, docId), {
      [fieldName]: increment(incrementBy)
    })).pipe(
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 📧 Verifica se e-mail já está registrado */
  checkIfEmailExists(email: string): Observable<boolean> {
    const q = query(collection(this.firestore, 'users'), where('email', '==', email.trim()));
    return runInInjectionContext(this.injector, () =>
      from(getDocs(q)).pipe(
        map(snapshot => snapshot.size > 0),
        catchError(err => this.firestoreErrorHandler.handleFirestoreError(err))
      )
    );
  }

  /** 💾 Salva dados iniciais do usuário autenticado com histórico de apelidos */
  saveInitialUserData(uid: string, data: IUserRegistrationData): Observable<void> {
    if (data.municipio && data.estado) {
      data.municipioEstado = `${data.municipio} - ${data.estado}`;
    }

    const userRef = doc(this.firestore, 'users', uid);
    const nicknameHistory = [
      {
        nickname: data.nickname.trim().toLowerCase(),
        date: Timestamp.now()
      }
    ];

    return from(setDoc(userRef, {
      ...data,
      nicknameHistory: arrayUnion(...nicknameHistory)
    }, { merge: true })).pipe(
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 🔖 Indexa apelido no índice público (para consulta de ineditismo) */
  savePublicIndexNickname(nickname: string): Observable<void> {
    const normalized = nickname.trim().toLowerCase();
    const docId = `nickname:${normalized}`;
    const data = {
      type: 'nickname',
      value: normalized,
      uid: getAuth().currentUser?.uid ?? null,
      createdAt: Timestamp.now(),
      lastChangedAt: Timestamp.now()
    };

    return from(setDoc(doc(this.firestore, 'public_index', docId), data)).pipe(
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 🔁 Atualiza apelido público (somente assinantes) */
  updatePublicNickname(oldNickname: string, newNickname: string, isSubscriber: boolean): Observable<void> {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) return throwError(() => new Error('Usuário não autenticado.'));
    if (!isSubscriber) return throwError(() => new Error('Mudança de apelido restrita a assinantes.'));

    const newDocId = `nickname:${newNickname.trim().toLowerCase()}`;
    const oldDocId = `nickname:${oldNickname.trim().toLowerCase()}`;

    const publicIndexCol = collection(this.firestore, 'public_index');
    const newDocRef = doc(publicIndexCol, newDocId);
    const oldDocRef = doc(publicIndexCol, oldDocId);

    return from(getDoc(newDocRef)).pipe(
      switchMap(docSnap => {
        if (docSnap.exists()) {
          return throwError(() => new Error('Novo apelido já está em uso.'));
        }

        return from(deleteDoc(oldDocRef)).pipe(
          switchMap(() => setDoc(newDocRef, {
            type: 'nickname',
            value: newNickname.toLowerCase(),
            uid: user.uid,
            createdAt: Timestamp.now(),
            lastChangedAt: Timestamp.now()
          }))
        );
      }),
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** ⚠️ Tratamento centralizado de erros */
  private handleFirestoreError(error: any): Observable<never> {
    this.globalErrorHandler.handleError(error);
    return throwError(() => error);
  }
}
