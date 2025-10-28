// src/app/core/services/data-handling/firestore-user-query.service.ts
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { from, Observable, of, switchMap, take, shareReplay, map, catchError, firstValueFrom, tap } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { addUserToState, updateUserInState } from 'src/app/store/actions/actions.user/user.actions';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';
import { CacheService } from '../general/cache/cache.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';

import { IUserDados } from '../../interfaces/iuser-dados';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

import {
  Firestore, doc, getDoc, docData, docSnapshots, getDocFromServer,
} from '@angular/fire/firestore';
import {
  collection, documentId, getDocs, query, where, DocumentReference, CollectionReference,
} from 'firebase/firestore';
import { userConverter } from './converters/user.firestore-converter';

export type UserPublic = { uid: string; nickname?: string; avatarUrl?: string };

@Injectable({ providedIn: 'root' })
export class FirestoreUserQueryService {

  constructor(
    private cache: CacheService,
    private store: Store<AppState>,
    private firestoreError: FirestoreErrorHandlerService,
    private db: Firestore,
    private injector: Injector
  ) { }

  /* ---------- helpers Firestore com converter ---------- */
  private usersCol() {
    return runInInjectionContext(this.injector, () =>
      collection(this.db, 'users').withConverter(userConverter)
    );
  }
  private userRef(uid: string) {
    return runInInjectionContext(this.injector, () =>
      doc(this.db, 'users', uid).withConverter(userConverter)
    );
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /* ---------- listagem pública (com converter) ---------- */
  getUsersPublicMap$(uids: string[]): Observable<Record<string, UserPublic>> {
    const ids = Array.from(new Set((uids ?? []).filter(Boolean)));
    if (!ids.length) return of({});

    const col = this.usersCol();
    const groups = this.chunk(ids, 10);

    return from((async () => {
      const mapOut: Record<string, UserPublic> = {};

      try {
        const snaps = await Promise.all(groups.map(g =>
          getDocs(query(col, where(documentId(), 'in', g)))
        ));
        for (const snap of snaps) {
          snap.forEach(d => {
            const data = d.data(); // IUserDados (já contém uid do converter)
            mapOut[data.uid] = {
              uid: data.uid,
              nickname: data?.nickname ?? (data as any)?.displayName ?? (data as any)?.name ?? undefined,
              avatarUrl: data?.photoURL ?? (data as any)?.avatarUrl ?? (data as any)?.imageUrl ?? undefined,
            };
            this.store.dispatch(addUserToState({ user: data }));
            this.cache.set(`user:${data.uid}`, data, 300_000);
          });
        }
        return mapOut;
      } catch {
        // Fallback (1 a 1) ainda com converter
        const docs = await Promise.all(ids.map(async uid => {
          const ds = await runInInjectionContext(this.injector, () =>
            getDoc(this.userRef(uid))
           );
          return ds.exists() ? ds.data() : null;
        }));
        for (const data of docs) {
          if (!data) continue;
          mapOut[data.uid] = {
            uid: data.uid,
            nickname: data?.nickname ?? (data as any)?.displayName ?? (data as any)?.name ?? undefined,
            avatarUrl: data?.photoURL ?? (data as any)?.avatarUrl ?? (data as any)?.imageUrl ?? undefined,
          };
          this.store.dispatch(addUserToState({ user: data }));
          this.cache.set(`user:${data.uid}`, data, 300_000);
        }
        return mapOut;
      }
    })()).pipe(
      catchError(err => { this.firestoreError.handleFirestoreError(err); return of({}); })
    );
  }

  /* ---------- leitura pontual (converter) ---------- */
  private getUserFromFirestore$(uid: string): Observable<IUserDados | null> {
    return from(
          runInInjectionContext(this.injector, () => getDoc(this.userRef(uid)))
         ).pipe(
      map(snap => (snap.exists() ? snap.data()! : null)),
      tap(user => {
        if (user) {
          this.store.dispatch(addUserToState({ user }));
          this.cache.set(`user:${uid}`, user, 300_000);
        }
      }),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }

  /* ---------- exists no servidor (sem converter é ok) ---------- */
  async checkUserExistsFromServer(uid: string): Promise<boolean> {
    try {
      const snap = await runInInjectionContext(this.injector, () =>
            getDocFromServer(doc(this.db, 'users', uid))
            );
      return snap.exists();
    } catch (error) {
      this.firestoreError.handleFirestoreError(error);
      return true;
    }
  }

  /* ---------- Cache -> Store -> Firestore ---------- */
  private fetchUser$(uid: string): Observable<IUserDados | null> {
    const id = uid.trim();
    return this.cache.get<IUserDados>(`user:${id}`).pipe(
      switchMap(cached => {
        if (cached) return of(cached);
        return this.store.select(selectUserProfileDataByUid(id)).pipe(
          take(1),
          switchMap(fromStore => (fromStore ? of(fromStore) : this.getUserFromFirestore$(id)))
        );
      }),
      shareReplay(1)
    );
  }

  /* ---------- stream reativo do doc (converter) ---------- */
  getUser(uid: string): Observable<IUserDados | null> {
    return runInInjectionContext(this.injector, () => docData(this.userRef(uid))).pipe(
      map(v => (v ?? null) as IUserDados | null),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }

  async getUserData(uid: string): Promise<IUserDados | null> {
    const id = uid.trim();
    const fromCache = await firstValueFrom(this.cache.get<IUserDados>(`user:${id}`));
    if (fromCache) return fromCache;
    return await firstValueFrom(this.getUser(id));
  }

  getUserWithObservable(uid: string): Observable<IUserDados | null> {
    return this.getUser(uid);
  }
  getUserById(uid: string): Observable<IUserDados | null> {
    return this.getUser(uid);
  }

  invalidateUserCache(uid: string): void {
    const id = uid.trim();
    // this.userObservablesCache.delete(id);
    this.cache.set(`user:${id}`, null as any, 1);
  }

  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    const key = `user:${uid}`;
    this.cache.get<T>(key).pipe(take(1)).subscribe(existing => {
      if (existing && JSON.stringify(existing) === JSON.stringify(updatedData)) return;
      this.cache.set(key, updatedData, 300_000);
      this.store.dispatch(updateUserInState({ uid, updatedData } as any));
    });
  }

  /* ---------- apenas para saber se o doc sumiu ---------- */
  watchUserDocDeleted$(uid: string): Observable<boolean> {
    // pode ser sem converter; se quiser padronizar:
    // const ref = this.userRef(uid);
    const ref = runInInjectionContext(this.injector, () => doc(this.db, 'users', uid));
    return runInInjectionContext(this.injector, () => docSnapshots(ref)).pipe(
      map(snap => !snap.exists()),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }
}
