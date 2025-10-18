//src\app\core\services\data-handling\firestore-user-query.service.ts
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
import { doc, getDoc, Firestore, docSnapshots, getDocFromServer, docData } from '@angular/fire/firestore';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';

export type UserPublic = { uid: string; nickname?: string; avatarUrl?: string };

@Injectable({ providedIn: 'root' })
export class FirestoreUserQueryService {
  private userObservablesCache = new Map<string, Observable<IUserDados | null>>();

  constructor(
    private cache: CacheService,
    private store: Store<AppState>,
    private firestoreError: FirestoreErrorHandlerService,
    private db: Firestore,
    private injector: Injector
  ) { }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  getUsersPublicMap$(uids: string[]): Observable<Record<string, UserPublic>> {
    const ids = Array.from(new Set((uids ?? []).filter(Boolean)));
    if (!ids.length) return of({} as Record<string, UserPublic>);

    const col = runInInjectionContext(this.injector, () => collection(this.db, 'users'));
    const groups = this.chunk(ids, 10); // 'in' aceita até 10

    return from(
      runInInjectionContext(this.injector, async () => {
        const mapOut: Record<string, UserPublic> = {};

        // Tenta batch por 'in'
        try {
          const snaps = await Promise.all(
            groups.map(g => getDocs(query(col, where(documentId(), 'in', g))))
          );
          for (const snap of snaps) {
            snap.forEach(d => {
              const data: any = d.data();
              mapOut[d.id] = {
                uid: d.id,
                nickname: data?.nickname ?? data?.displayName ?? data?.name ?? undefined,
                avatarUrl: data?.photoURL ?? data?.avatarUrl ?? data?.imageUrl ?? undefined,
              };
              // opcional: hidratar store+cache
              this.store.dispatch(addUserToState({ user: { uid: d.id, ...data } as IUserDados }));
              this.cache.set(`user:${d.id}`, { uid: d.id, ...data }, 300_000);
            });
          }
          return mapOut;
        } catch {
          // Fallback (se 'documentId()' não estiver acessível): N leituras individuais
          const docs = await Promise.all(
            ids.map(async uid => {
              const ds = await getDoc(runInInjectionContext(this.injector, () => doc(this.db, 'users', uid)));
              return ds.exists() ? { uid: ds.id, ...(ds.data() as any) } : null;
            })
          );
          for (const d of docs) {
            if (!d) continue;
            mapOut[d.uid] = {
              uid: d.uid,
              nickname: d.nickname ?? d.displayName ?? d.name ?? undefined,
              avatarUrl: d.photoURL ?? d.avatarUrl ?? d.imageUrl ?? undefined,
            };
            this.store.dispatch(addUserToState({ user: d as IUserDados }));
            this.cache.set(`user:${d.uid}`, d as any, 300_000);
          }
          return mapOut;
        }
      })
    ).pipe(
      catchError(err => {
        this.firestoreError.handleFirestoreError(err);
        // devolve um mapa vazio, mantendo tipagem do efeito
        return of({} as Record<string, UserPublic>);
     })
    );
  }

  private getUserFromFirestore$(uid: string): Observable<IUserDados | null> {
    const ref = runInInjectionContext(this.injector, () => doc(this.db, 'users', uid));
    return from(runInInjectionContext(this.injector, () => getDoc(ref))).pipe(
      map(snap => (snap.exists() ? (snap.data() as IUserDados) : null)),
      tap(user => {
        if (user) {
          this.store.dispatch(addUserToState({ user }));
          this.cache.set(`user:${uid}`, user, 300_000);
        }
      }),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }

  async checkUserExistsFromServer(uid: string): Promise<boolean> {
    try {
      return await runInInjectionContext(this.injector, async () => {
        const ref = doc(this.db, 'users', uid);
        const snap = await getDocFromServer(ref);
        return snap.exists();
      });
    } catch (error) {
      this.firestoreError.handleFirestoreError(error);
      // Em caso de erro, seja conservador para não derrubar sessão por engano
      return true;
    }
  }

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

  getUser(uid: string): Observable<any | null> {
    const ref = runInInjectionContext(this.injector, () => doc(this.db, 'users', uid));
    return runInInjectionContext(this.injector, () => docData<any>(ref, { idField: 'uid' }));
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
    this.userObservablesCache.delete(id);
    this.cache.set(`user:${id}`, null, 1);
  }

  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    const key = `user:${uid}`;
    this.cache.get<T>(key).pipe(take(1)).subscribe(existing => {
      if (existing && JSON.stringify(existing) === JSON.stringify(updatedData)) return;
      this.cache.set(key, updatedData, 300_000);
      this.store.dispatch(updateUserInState({ uid, updatedData } as any));
    });
  }

  watchUserDocDeleted$(uid: string): Observable<boolean> {
    const ref = runInInjectionContext(this.injector, () => doc(this.db, 'users', uid));
    return runInInjectionContext(this.injector, () => docSnapshots(ref)).pipe(
      map(snap => !snap.exists()),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }
}
