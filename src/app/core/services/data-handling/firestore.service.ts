// src/app/core/services/data-handling/firestore.service.ts
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

// ✅ pegue o app padrão inicializado pelo AngularFire compat
import { getApp } from 'firebase/app';

// ✅ use o SDK Web modular direto
import {
  getFirestore as getFirestoreMod,
  Firestore as FirestoreMod,
  collection, doc, query, QueryConstraint,
  setDoc, updateDoc, deleteDoc, increment,
  WithFieldValue, DocumentData,
  getDocs, where, getDoc, arrayUnion,
  Timestamp
} from 'firebase/firestore';

// (opcional) util do AngularFire para stream de coleções
import { collectionData } from '@angular/fire/firestore';
import { getAuth } from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class FirestoreService {

  constructor(
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreErrorHandler: FirestoreErrorHandlerService,
    private cacheService: CacheService,
    private injector: Injector
  ) { }

  /** 🔍 Retorna instância do Firestore (SDK Web modular) */
  getFirestoreInstance(): FirestoreMod {
    // usa o app default criado por AngularFireModule.initializeApp(...)
    return getFirestoreMod(getApp());
  }

  /** 🔎 Lê o documento do índice público de apelido (ou null se não existir). */
  getPublicNicknameIndex(nickname: string): Observable<any | null> {
    const normalized = nickname.trim().toLowerCase();
    const docId = `nickname:${normalized}`;
    return this.getDocument<any>('public_index', docId);
  }

  /** ⚡ Check de existência do índice de apelido (O(1)). */
  checkNicknameIndexExists(nickname: string): Observable<boolean> {
    return this.getPublicNicknameIndex(nickname).pipe(map(doc => !!doc));
  }

  /** 🔍 Busca documento por ID */
  getDocument<T>(collectionName: string, docId: string): Observable<T | null> {
    const db = this.getFirestoreInstance();
    const docRef = doc(db, collectionName, docId);
    return from(getDoc(docRef)).pipe(
      map(snap => (snap.exists() ? (snap.data() as T) : null)),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 📋 Busca múltiplos documentos com cache opcional */
  getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    useCache = true,
    cacheTTL = 5 * 60 * 1000
  ): Observable<T[]> {
    const db = this.getFirestoreInstance();
    const cacheKey = `${collectionName}:${JSON.stringify(constraints)}`;

    return (useCache ? this.cacheService.get<T[]>(cacheKey) : of(null)).pipe(
      switchMap(cached => cached
        ? of(cached)
        : runInInjectionContext(this.injector, () => {
          const colRef = collection(db, collectionName);
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

  /** ➕ Adiciona documento com ID automático */
  addDocument<T extends WithFieldValue<DocumentData>>(collectionName: string, data: T): Observable<void> {
    const db = this.getFirestoreInstance();
    const colRef = collection(db, collectionName);
    return from(setDoc(doc(colRef), data)).pipe(
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 📝 Atualiza documento parcial */
  updateDocument(collectionName: string, docId: string, data: Partial<any>): Observable<void> {
    const db = this.getFirestoreInstance();
    return from(updateDoc(doc(db, collectionName, docId), data)).pipe(
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 🗑️ Deleta documento */
  deleteDocument(collectionName: string, docId: string): Observable<void> {
    const db = this.getFirestoreInstance();
    return from(deleteDoc(doc(db, collectionName, docId))).pipe(
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 🔢 Incrementa campo numérico */
  incrementField(collectionName: string, docId: string, fieldName: string, incrementBy: number): Observable<void> {
    const db = this.getFirestoreInstance();
    return from(updateDoc(doc(db, collectionName, docId), {
      [fieldName]: increment(incrementBy)
    })).pipe(
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 📧 Verifica se e-mail já está registrado */
  checkIfEmailExists(email: string): Observable<boolean> {
    const db = this.getFirestoreInstance();
    const qCol = query(collection(db, 'users'), where('email', '==', email.trim()));
    return from(getDocs(qCol)).pipe(
      map(snapshot => snapshot.size > 0),
      catchError(err => this.firestoreErrorHandler.handleFirestoreError(err))
    );
  }

  /** 💾 Salva dados iniciais com histórico de apelidos */
  saveInitialUserData(uid: string, data: IUserRegistrationData): Observable<void> {
    const db = this.getFirestoreInstance();

    if (data.municipio && data.estado) {
      data.municipioEstado = `${data.municipio} - ${data.estado}`;
    }

    const userRef = doc(db, 'users', uid);
    const nicknameHistory = [
      { nickname: data.nickname.trim().toLowerCase(), date: Timestamp.now() }
    ];

    return from(setDoc(userRef, { ...data, nicknameHistory: arrayUnion(...nicknameHistory) }, { merge: true })).pipe(
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 🔖 Indexa apelido no índice público */
  savePublicIndexNickname(nickname: string): Observable<void> {
    const db = this.getFirestoreInstance();
    const normalized = nickname.trim().toLowerCase();
    const docId = `nickname:${normalized}`;
    const data = {
      type: 'nickname',
      value: normalized,
      uid: getAuth().currentUser?.uid ?? null,
      createdAt: Timestamp.now(),
      lastChangedAt: Timestamp.now()
    };

    return from(setDoc(doc(db, 'public_index', docId), data)).pipe(
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** 🔁 Atualiza apelido público (somente assinantes) */
  updatePublicNickname(oldNickname: string, newNickname: string, isSubscriber: boolean): Observable<void> {
    const db = this.getFirestoreInstance();
    const authUser = getAuth().currentUser;

    if (!authUser) return throwError(() => new Error('Usuário não autenticado.'));
    if (!isSubscriber) return throwError(() => new Error('Mudança de apelido restrita a assinantes.'));

    const newDocId = `nickname:${newNickname.trim().toLowerCase()}`;
    const oldDocId = `nickname:${oldNickname.trim().toLowerCase()}`;

    const newDocRef = doc(db, 'public_index', newDocId);
    const oldDocRef = doc(db, 'public_index', oldDocId);

    return from(getDoc(newDocRef)).pipe(
      switchMap(snap => {
        if (snap.exists()) {
          return throwError(() => new Error('Novo apelido já está em uso.'));
        }
        return from(deleteDoc(oldDocRef)).pipe(
          switchMap(() => setDoc(newDocRef, {
            type: 'nickname',
            value: newNickname.toLowerCase(),
            uid: authUser.uid,
            createdAt: Timestamp.now(),
            lastChangedAt: Timestamp.now()
          }))
        );
      }),
      map(() => void 0),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** ⚠️ Tratamento centralizado */
  private handleFirestoreError(error: any): Observable<never> {
    this.globalErrorHandler.handleError(error);
    return throwError(() => error);
  }
}
