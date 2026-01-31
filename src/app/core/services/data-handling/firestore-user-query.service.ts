// src/app/core/services/data-handling/firestore-user-query.service.ts
// Serviço para consultas de usuários no Firestore, com cache e tratamento de erros
// Não esquecer os comentários e ferramentas de debug
import { Injectable } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, take, tap } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { AppState } from 'src/app/store/states/app.state';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';

import { IUserDados } from '../../interfaces/iuser-dados';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

import { CacheService } from '../general/cache/cache.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';

import { UsersReadRepository } from './firestore/repositories/users-read.repository';
import { UserStateCacheService } from './firestore/state/user-state-cache.service';

export type UserPublic = { uid: string; nickname?: string; avatarUrl?: string };

@Injectable({ providedIn: 'root' })
export class FirestoreUserQueryService {
  constructor(
    private readonly cache: CacheService,
    private readonly store: Store<AppState>,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly usersReadRepo: UsersReadRepository,
    private readonly userStateCache: UserStateCacheService
  ) { }

  // =========================
  // Public map (batch)
  // =========================
  getUsersPublicMap$(uids: string[]): Observable<Record<string, UserPublic>> {
    const ids = Array.from(new Set((uids ?? []).filter(Boolean).map(x => String(x).trim()).filter(Boolean)));
    if (!ids.length) return of({});

    return this.usersReadRepo.getUsersByUidsOnce$(ids).pipe(
      map((users) => {
        const out: Record<string, UserPublic> = {};

        for (const u of users ?? []) {
          if (!u?.uid) continue;

          out[u.uid] = {
            uid: u.uid,
            nickname: (u as any)?.nickname ?? (u as any)?.displayName ?? (u as any)?.name ?? undefined,
            avatarUrl: (u as any)?.photoURL ?? (u as any)?.avatarUrl ?? (u as any)?.imageUrl ?? undefined,
          };

          // ✅ padroniza: store + cache via serviço dedicado
          this.userStateCache.upsertUser(u);
        }

        return out;
      }),
      catchError((err) => {
        this.firestoreError.handleFirestoreError(err);
        return of({});
      })
    );
  }

  // =========================
  // Exists (server)
  // =========================
  async checkUserExistsFromServer(uid: string): Promise<boolean> {
    const id = (uid ?? '').trim();
    if (!id) return false;
    return this.usersReadRepo.checkUserExistsFromServer(id);
  }

  // =========================
  // Cache -> Store -> Firestore(once)
  // =========================
  private fetchUser$(uid: string): Observable<IUserDados | null> {
    const id = (uid ?? '').trim();
    if (!id) return of(null);

    return this.cache.get<IUserDados>(`user:${id}`).pipe(
      switchMap((cached) => {
        if (cached) return of(cached);

        return this.store.select(selectUserProfileDataByUid(id)).pipe(
          take(1),
          switchMap((fromStore) => {
            if (fromStore) return of(fromStore);

            return this.usersReadRepo.getUserOnce$(id).pipe(
              tap((user) => {
                if (user) this.userStateCache.upsertUser(user);
              })
            );
          })
        );
      }),
      shareReplay(1),
      catchError((err) => this.firestoreError.handleFirestoreError(err))
    );
  }

  /**
 * Snapshot determinístico para Guards e navegação crítica.
 * Usa o pipeline completo (cache -> store -> firestore once).
 */
  getUserOnce$(uid: string): Observable<IUserDados | null> {
    return this.fetchUser$(uid).pipe(
      take(1),
      catchError((err) =>
        this.firestoreError.handleFirestoreErrorAndReturnNull<IUserDados>(err, {
          silent: true,
          context: 'auth-guard.getUserOnce$'
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

 // "once direto do Firestore" sem cache/store
getUserOnceFromFirestore$(uid: string): Observable < IUserDados | null > {
  const id = (uid ?? '').trim();
  if(!id) return of(null);
  return this.usersReadRepo.getUserOnce$(id).pipe(take(1));
}

  // =========================
  // Realtime stream
  // =========================
  // getUser aqui é realtime (via store), mas tem getUser$ no user-repository.service.ts e no user-repository.service.ts
  getUser(uid: string): Observable<IUserDados | null> {
    const id = (uid ?? '').trim();
    if (!id) return of(null);

    return this.usersReadRepo.getUser$(id).pipe(
      tap((user) => { if (user) this.userStateCache.upsertUser(user); }),
      catchError((err) =>
        this.firestoreError.handleFirestoreErrorAndReturnNull<IUserDados>(err, {
          context: 'FirestoreUserQueryService.getUser(realtime)',
          silent: true
        })
      )
    );
  }

  async getUserData(uid: string): Promise<IUserDados | null> {
    // ✅ agora usa o pipeline completo (cache -> store -> firestore once)
    return await firstValueFrom(this.fetchUser$(uid).pipe(take(1)));
  }

  getUserWithObservable(uid: string): Observable<IUserDados | null> {
    return this.getUser(uid);
  }

  getUserById(uid: string): Observable<IUserDados | null> {
    return this.getUser(uid);
  }

  invalidateUserCache(uid: string): void {
    this.userStateCache.invalidate(uid);
  }

  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    this.userStateCache.updateUserInStateAndCache(uid, updatedData);
  }

  watchUserDocDeleted$(uid: string): Observable<boolean> {
    const id = (uid ?? '').trim();
    if (!id) return of(false);
    return this.usersReadRepo.watchUserDocDeleted$(id);
  }
}//Linha169
/*
2) Garantir que FirestoreUserQueryService tenha um método realtime (observeUser$)
Se o seu getUser(uid) já usa docData() e emite realtime, você pode reaproveitar e não criar método novo (só trocar a chamada no effect).
Se getUser(uid) for “one-shot” (getDoc), adicione este método no mesmo service (sem arquivo novo):
*/
/*
PS C:\entretenimento\src\app\core\services\data-handling\firestore> tree /f
Listagem de caminhos de pasta para o volume Windows
O número de série do volume é 1C9B-11ED
C:.
pasta firestore
├───core
│       firestore-context.service.ts
│       firestore-live-query.service.ts
│       firestore-read.service.ts
│       firestore-write.service.ts
│
├───repositories
│       public-index.repository.ts
│       public-profiles.repository.ts
│       user-repository.service.ts
│       users-read.repository.ts
│
├───state
│       user-state-cache.service.ts
│
└───validation
        firestore-validation.service.ts

PS C:\entretenimento\src\app\core\services\data-handling\firestore>
*/
