// src\app\core\services\data-handling\firestore\repositories\user-repository.service.ts
// Dono oficial para leitura de usuário:
// - getUser$ / getUserById$ : snapshot determinístico (cache -> store -> firestore once)
// - watchUser$              : realtime (docData memoizado no UsersReadRepository)
// Observação:
// - Mantém nomenclaturas e reatividade via Observable.
// - Erros passam pelo FirestoreErrorHandlerService (que deve rotear para GlobalErrorHandlerService + ErrorNotificationService conforme sua política).
// - Evita dependência em FirestoreUserQueryService (remove ciclo).
import { Injectable } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { catchError, finalize, shareReplay, switchMap, take, tap } from 'rxjs/operators';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';

import { serverTimestamp as fsServerTimestamp } from '@angular/fire/firestore';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';

import { UsersReadRepository } from '@core/services/data-handling/firestore/repositories/users-read.repository';
import { UserStateCacheService } from '@core/services/data-handling/firestore/state/user-state-cache.service';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { IUserRegistrationData } from '@core/interfaces/iuser-registration-data';
import { FirestoreWriteService } from '../core/firestore-write.service';

// ✅ ajuste o import para o caminho real do seu FirestoreWriteService
// Pela sua árvore, o arquivo está em: services/data-handling/firestore/core/firestore-write.service.ts

@Injectable({ providedIn: 'root' })
export class UserRepositoryService {
  private readonly inflightGetUser = new Map<string, Observable<IUserDados | null>>();
  constructor(
    private readonly write: FirestoreWriteService,
    private readonly store: Store<AppState>,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly usersReadRepo: UsersReadRepository,
    private readonly userStateCache: UserStateCacheService,
  ) { }

  private norm(uid: string): string {
    return (uid ?? '').toString().trim();
  }

  // ============================================================
  // READ - snapshot determinístico (cache -> store -> firestore once)
  // ============================================================
  /**
   * getUser$(uid)
   * Snapshot determinístico para Guards / policies / navegação crítica.
   * Pipeline:
   * 1) Cache (CacheService)
   * 2) Store (NgRx) - leitura única
   * 3) Firestore once (UsersReadRepository.getUserOnce$)
   *
   * Se encontrar usuário, padroniza store+cache via UserStateCacheService.
   */
  getUser$(uid: string): Observable<IUserDados | null> {
    const id = this.norm(uid);
    if (!id) return of(null);

    const existing = this.inflightGetUser.get(id);
    if (existing) return existing;

    const obs$ = this.userStateCache.getCachedUser$(id).pipe(
      take(1),
      switchMap((cached) => {
        if (cached !== undefined) return of((cached ?? null) as IUserDados | null);

        return this.store.select(selectUserProfileDataByUid(id)).pipe(
          take(1),
          switchMap((fromStore) => fromStore ? of(fromStore) : this.usersReadRepo.getUserOnce$(id)),
          tap((user) => { if (user) this.userStateCache.upsertUser(user); })
        );
      }),
      catchError((err) =>
        this.firestoreError.handleFirestoreErrorAndReturnNull<IUserDados>(err, {
          silent: true,
          context: 'UserRepositoryService.getUser$',
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true }),
      finalize(() => this.inflightGetUser.delete(id))
    );

    this.inflightGetUser.set(id, obs$);
    return obs$;
  }

  /**
   * getUserById$(uid)
   * Alias semântico (mantém compat com chamadas antigas).
   */
  getUserById$(uid: string): Observable<IUserDados | null> {
    return this.getUser$(uid);
  }

  /**
   * getUserById(uid)
   * Alias que mantém o padrão "sem $" que você já usa em vários pontos.
   * Continua retornando Observable (não quebra reatividade).
   */
  getUserById(uid: string): Observable<IUserDados | null> {
    return this.getUser$(uid);
  }

  /**
   * getUserData(uid)
   * Helper Promise para fluxos legados (evite em UI; prefira Observable).
   */
  async getUserData(uid: string): Promise<IUserDados | null> {
    return await firstValueFrom(this.getUser$(uid).pipe(take(1)));
  }

  // ============================================================
  // READ - realtime
  // ============================================================
  /**
   * watchUser$(uid)
   * Stream realtime do doc /users/{uid}.
   * O UsersReadRepository já memoiza listeners por UID (evita múltiplos onSnapshot).
   * Também padroniza store+cache quando o doc emite.
   */
  watchUser$(uid: string): Observable<IUserDados | null> {
    const id = this.norm(uid);
    if (!id) return of(null);

    return this.usersReadRepo.watchUser$(id).pipe(
      tap((user) => {
        if (user) this.userStateCache.upsertUser(user);
      }),
      catchError((err) =>
        this.firestoreError.handleFirestoreErrorAndReturnNull<IUserDados>(err, {
          silent: true,
          context: 'UserRepositoryService.watchUser$'
        })
      )
    );
  }

  // ============================================================
  // Cache/Store helpers (delegação para serviço especializado)
  // ============================================================
  invalidateUserCache(uid: string): void {
    const id = this.norm(uid);
    if (!id) return;
    this.userStateCache.invalidate(id);
  }

  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    const id = this.norm(uid);
    if (!id) return;
    this.userStateCache.updateUserInStateAndCache(id, updatedData);
  }

  // ============================================================
  // Outros utilitários de leitura que você já usa
  // ============================================================
  checkUserExistsFromServer(uid: string): Promise<boolean> {
    const id = this.norm(uid);
    if (!id) return Promise.resolve(false);
    return this.usersReadRepo.checkUserExistsFromServer(id);
  }

  watchUserDocDeleted$(uid: string): Observable<boolean> {
    const id = this.norm(uid);
    if (!id) return of(false);
    return this.usersReadRepo.watchUserDocDeleted$(id);
  }

  // ============================================================
  // WRITE (mantém o que você já tinha)
  // ============================================================
  setEmailVerified$(uid: string, status: boolean): Observable<void> {
    const id = this.norm(uid);
    if (!id) return of(void 0);
    return this.write.updateDocument('users', id, { emailVerified: status });
  }

  markLastLogin$(uid: string): Observable<void> {
    const id = this.norm(uid);
    if (!id) return of(void 0);

    // best-effort (não derruba fluxo)
    return this.write.updateDocument('users', id, { lastLogin: fsServerTimestamp() }).pipe(
      catchError(() => of(void 0))
    );
  }

  /**
  * @deprecated Presença é controlada exclusivamente por PresenceService (AuthOrchestratorService).
  * Mantido por compat para não quebrar chamadas antigas.
  */
  setOnline$(_uid: string, _online: boolean): Observable<void> {
    return of(void 0);
  }
}
