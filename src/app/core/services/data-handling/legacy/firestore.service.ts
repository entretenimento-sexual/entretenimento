// src/app/core/services/data-handling/firestore.service.ts
// Sendo descontiunado em favor de FirestoreRead/WriteService + Repositories
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { CacheService } from '../../general/cache/cache.service';
import { FirestoreErrorHandlerService } from '../../error-handler/firestore-error-handler.service';
import { IUserRegistrationData } from '../../../interfaces/iuser-registration-data';

import { Firestore,  collection, doc, query, type QueryConstraint,
          setDoc, updateDoc, deleteDoc, increment,
          getDocs, where, getDoc, arrayUnion,
          Timestamp, collectionData, type DocumentData,
          getDocFromServer,
          getDocFromCache
        } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import type { WithFieldValue } from 'firebase/firestore';
import { environment } from 'src/environments/environment';

type GetDocSource = 'default' | 'server' | 'cache';
type DocSource = 'server' | 'cache'; //DocSource está esmaecido
type GetDocumentsMode = 'realtime' | 'once';
type GetDocumentsOpts = {
  mode?: GetDocumentsMode;
  mapIdField?: string | null; // só faz sentido no "once"
};

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private readonly firestore = inject(Firestore);
  constructor(
    private firestoreErrorHandler: FirestoreErrorHandlerService,
    private cacheService: CacheService,
    private injector: Injector,
    private db: Firestore,
    private auth: Auth,
  ) { }

  /** Helper: log só em dev/staging */
  private debugLog(message: string, payload?: unknown): void {
    if (environment.enableDebugTools) {
      console.debug('[FirestoreService]', message, payload ?? '');
    }
  }

  /** Helper: garante *Injection Context* para chamadas AngularFire */
  private afRun<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getFirestoreInstance(): Firestore {
    return this.db;
  }

  getPublicNicknameIndex(nickname: string): Observable<any | null> {
    const normalized = nickname.trim().toLowerCase();
    const docId = `nickname:${normalized}`;
    this.debugLog('getPublicNicknameIndex', { docId });

    // ✅ Para fase de registro, prefira "server" (evita "listen one-shot" em muitos casos)
    return this.getDocument<any>('public_index', docId, { source: 'server' });
  }

  checkNicknameIndexExists(nickname: string): Observable<boolean> {
    return this.getPublicNicknameIndex(nickname).pipe(
      map(doc => !!doc)
    );
  }

  /** 🔎 GET por ID — opcionalmente forçando origem */
  getDocument<T>(
    collectionName: string,
    docId: string,
    opts?: { source?: GetDocSource }
  ): Observable<T | null> {
    this.debugLog('getDocument', { collectionName, docId, source: opts?.source });

    return this.afRun(() => {
      const ref = doc(this.db, collectionName, docId);

      const run = (source: GetDocSource) => {
        const req =
          source === 'server' ? from(getDocFromServer(ref)) :
            source === 'cache' ? from(getDocFromCache(ref)) :
              from(getDoc(ref));

        return req.pipe(map(snap => (snap.exists() ? (snap.data() as T) : null)));
      };

      const source = opts?.source ?? 'default';

      return run(source).pipe(
        catchError((err) => {
          // ✅ fallback conservador: se pediu server, mas está offline, tenta cache/default
          if (source === 'server' && typeof navigator !== 'undefined' && navigator.onLine === false) {
            return run('cache').pipe(
              catchError(() => run('default')),
            );
          }
          return this.handleFirestoreError(err);
        })
      );
    });
  }


  /** 📋 GET lista — com cache + Injection Context */
  getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    useCache = true,
    cacheTTL = 5 * 60 * 1000,
    opts?: GetDocumentsOpts
  ): Observable<T[]> {
    const mode: GetDocumentsMode = opts?.mode ?? 'realtime';

    // ✅ Agora o getDocumentsOnce passa a ser usado de verdade
    if (mode === 'once') {
      return this.getDocumentsOnce<T>(
        collectionName,
        constraints,
        useCache,
        cacheTTL,
        opts?.mapIdField ?? 'id'
      );
    }

    const cacheKey = `${collectionName}:${JSON.stringify(constraints)}`;
    this.debugLog('getDocuments', { collectionName, cacheKey, useCache, mode });

    return (useCache ? this.cacheService.get<T[]>(cacheKey) : of(null)).pipe(
      switchMap(cached =>
        (cached !== null && cached !== undefined)
          ? of(cached)
          : this.afRun(() => {
            const colRef = collection(this.db, collectionName);
            const q = query(colRef, ...constraints);

            // realtime (listener)
            return collectionData(q as any, { idField: 'id' }).pipe(
              tap(data => useCache && this.cacheService.set(cacheKey, data, cacheTTL)),
              map(data => data as T[])
            );
          })
      ),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  getDocumentsOnce<T>(
    collectionName: string,
    constraints: QueryConstraint[] = [],
    useCache = true,
    cacheTTL = 5 * 60 * 1000,
    mapIdField: string | null = 'id'
  ): Observable<T[]> {
    const cacheKey = `${collectionName}:once:${JSON.stringify(constraints)}`;
    this.debugLog('getDocumentsOnce', { collectionName, cacheKey, useCache });

    return (useCache ? this.cacheService.get<T[]>(cacheKey) : of(null)).pipe(
      switchMap(cached => {
        if (cached !== null && cached !== undefined) return of(cached);

        return this.afRun(() => {
          const colRef = collection(this.db, collectionName);
          const q = query(colRef, ...constraints);

          return from(getDocs(q)).pipe(
            map(snap =>
              snap.docs.map(d => {
                const data = d.data() as any;
                return (mapIdField ? { [mapIdField]: d.id, ...data } : data) as T;
              })
            ),
            tap(data => useCache && this.cacheService.set(cacheKey, data, cacheTTL))
          );
        });
      }),
      catchError(err => this.handleFirestoreError(err))
    );
  }

  /** ➕ ADD — dentro do Injection Context */
  addDocument<T extends WithFieldValue<DocumentData>>(collectionName: string, data: T): Observable<void> {
    this.debugLog('addDocument', { collectionName });

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
    this.debugLog('updateDocument', { collectionName, docId });

    return this.afRun(() =>
      from(updateDoc(doc(this.db, collectionName, docId), data)).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      )
    );
  }

  /** 🗑️ DELETE — dentro do Injection Context */
  deleteDocument(collectionName: string, docId: string): Observable<void> {
    this.debugLog('deleteDocument', { collectionName, docId });

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
    this.debugLog('incrementField', { collectionName, docId, fieldName, incBy });

    return this.afRun(() => {
      const ref = doc(this.db, collectionName, docId);
      return from(updateDoc(ref, { [fieldName]: increment(incBy) })).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  /** E-mail já usado na coleção users (consulta Firestore) */
  checkIfEmailExists(email: string): Observable<boolean> {
    const trimmed = email.trim();
    this.debugLog('checkIfEmailExists', { email: trimmed });

    return this.afRun(() => {
      const qCol = query(collection(this.db, 'users'), where('email', '==', trimmed));
      return from(getDocs(qCol)).pipe(
        map(snapshot => snapshot.size > 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  saveInitialUserData(uid: string, data: IUserRegistrationData): Observable<void> {
    this.debugLog('saveInitialUserData', { uid });

    if ((data as any).municipio && (data as any).estado) {
      (data as any).municipioEstado = `${(data as any).municipio} - ${(data as any).estado}`;
    }

    return this.afRun(() => {
      const userRef = doc(this.db, 'users', uid);
      const nicknameHistory = [{ nickname: data.nickname.trim().toLowerCase(), date: Timestamp.now() }];
      return from(
        setDoc(userRef, { ...data, nicknameHistory: arrayUnion(...nicknameHistory) }, { merge: true })
      ).pipe(
        map(() => void 0),
        catchError(err => this.handleFirestoreError(err))
      );
    });
  }

  savePublicIndexNickname(nickname: string): Observable<void> {
    const normalized = nickname.trim().toLowerCase();

    if (!this.auth.currentUser) {
      return throwError(() => new Error('Usuário não autenticado.'));
    }

    this.debugLog('savePublicIndexNickname', { normalized, uid: this.auth.currentUser.uid });

    return this.afRun(() => {
      const docId = `nickname:${normalized}`;
      const data = {
        type: 'nickname',
        value: normalized,
        uid: this.auth.currentUser!.uid,
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
    if (!this.auth.currentUser) {
      return throwError(() => new Error('Usuário não autenticado.'));
    }
    if (!isSubscriber) {
      return throwError(() => new Error('Mudança de apelido restrita a assinantes.'));
    }

    const normalizedOld = oldNickname.trim().toLowerCase();
    const normalizedNew = newNickname.trim().toLowerCase();

    this.debugLog('updatePublicNickname', {
      uid: this.auth.currentUser.uid,
      old: normalizedOld,
      next: normalizedNew
    });

    return this.afRun(() => {
      const newDocId = `nickname:${normalizedNew}`;
      const oldDocId = `nickname:${normalizedOld}`;
      const newDocRef = doc(this.db, 'public_index', newDocId);
      const oldDocRef = doc(this.db, 'public_index', oldDocId);

      return from(getDoc(newDocRef)).pipe(
        switchMap(snap => {
          if (snap.exists()) {
            return throwError(() => new Error('Novo apelido já está em uso.'));
          }

          return from(deleteDoc(oldDocRef)).pipe(
            switchMap(() =>
              setDoc(newDocRef, {
                type: 'nickname',
                value: normalizedNew,
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

  /** Centraliza tratamento de erro de Firestore neste serviço especializado */
  private handleFirestoreError(error: any): Observable<never> {
    return this.firestoreErrorHandler.handleFirestoreError(error);
  }
} // linha 343
