// src/app/core/services/data-handling/firestore-user-query.service.ts
import { Inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { from, Observable, of, switchMap, take, shareReplay, map, catchError, firstValueFrom, tap } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { addUserToState, updateUserInState } from 'src/app/store/actions/actions.user/user.actions';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';
import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

@Injectable({ providedIn: 'root' })
export class FirestoreUserQueryService {
  private userObservablesCache = new Map<string, Observable<IUserDados | null>>();

  constructor(
    private cache: CacheService,
    private store: Store<AppState>,
    private globalError: GlobalErrorHandlerService,
    private firestoreError: FirestoreErrorHandlerService,
    private injector: Injector,
    @Inject(Firestore) private firestore: Firestore
  ) { }

  /** Lê direto do Firestore (Injection-context safe) */
  private getUserFromFirestore$(uid: string): Observable<IUserDados | null> {
    return runInInjectionContext(this.injector, () => {
      const ref = doc(this.firestore, 'users', uid);
      return from(getDoc(ref)).pipe(
        map(snap => (snap.exists() ? (snap.data() as IUserDados) : null)),
        tap(user => {
          if (user) {
            this.store.dispatch(addUserToState({ user }));
            this.cache.set(`user:${uid}`, user, 300_000);
          }
        }),
        catchError(err => this.firestoreError.handleFirestoreError(err))
      );
    });
  }

  /** Caminho único de leitura com cache + store + Firestore */
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

  /** API pública simples (observable) com memoização por UID */
  getUser(uid: string): Observable<IUserDados | null> {
    const id = uid.trim();
    if (!this.userObservablesCache.has(id)) {
      this.userObservablesCache.set(id, this.fetchUser$(id));
    }
    return this.userObservablesCache.get(id)!;
  }

  /** API pública async/await (se precisar em componentes) */
  async getUserData(uid: string): Promise<IUserDados | null> {
    const id = uid.trim();
    const fromCache = await firstValueFrom(this.cache.get<IUserDados>(`user:${id}`));
    if (fromCache) return fromCache;
    return await firstValueFrom(this.getUser(id));
  }

  /** 🔁 Alias de compatibilidade: mantém a API antiga funcionando */
  getUserWithObservable(uid: string): Observable<IUserDados | null> {
    return this.getUser(uid);
  }

  /** 🔁 Outro alias de compatibilidade (se usado em algum lugar) */
  getUserById(uid: string): Observable<IUserDados | null> {
    return this.getUser(uid);
  }

  /** ♻️ Invalida caches e o observable memorizado (caso precise forçar reload) */
  invalidateUserCache(uid: string): void {
    const id = uid.trim();
    this.userObservablesCache.delete(id);
    // se seu CacheService tiver delete, use; senão, set TTL curto:
    this.cache.set(`user:${id}`, null as any, 1);
  }

  /** Atualiza cache + store */
  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    const key = `user:${uid}`;
    this.cache.get<T>(key).pipe(take(1)).subscribe(existing => {
      if (existing && JSON.stringify(existing) === JSON.stringify(updatedData)) return;
      this.cache.set(key, updatedData, 300_000);
      this.store.dispatch(updateUserInState({ uid, updatedData } as any));
    });
  }
}
