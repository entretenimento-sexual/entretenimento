// src/app/core/services/data-handling/firestore-user-query.service.ts
// Adapter/compat layer.
// Objetivo: delegar para o DONO (UserRepositoryService) e marcar aliases como @deprecated.
// Mantém métodos usados no projeto, mas evita duplicar regra de cache/store/firestore.
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { IUserDados } from '../../interfaces/iuser-dados';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { UserPublic } from '@core/interfaces/user-public.interface';

import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';

import { UserStateCacheService } from './firestore/state/user-state-cache.service';
import { UserRepositoryService } from './firestore/repositories/user-repository.service';
import { UserDiscoveryQueryService } from './queries/user-discovery.query.service';
import { UsersReadRepository } from './firestore/repositories/users-read.repository';

@Injectable({ providedIn: 'root' })
export class FirestoreUserQueryService {
constructor(
  private readonly firestoreError: FirestoreErrorHandlerService,
  private readonly usersReadRepo: UsersReadRepository,
  private readonly userStateCache: UserStateCacheService,
  private readonly userRepo: UserRepositoryService,
  private readonly discoveryQuery: UserDiscoveryQueryService
) { }

  // ============================================================
  // Public map (batch) - pode migrar para UserRepositoryService depois
  // ============================================================
/**
 * Public map (batch)
 *
 * Ajuste principal:
 * - deixa de ler /users (privado)
 * - passa a ler /public_profiles via UserDiscoveryQueryService
 *
 * Motivo:
 * - fluxo público/social não deve depender de query/list em /users
 * - suas rules já suportam public_profiles para leitura autenticada
 */
getUsersPublicMap$(uids: string[]): Observable<Record<string, UserPublic>> {
  const ids = Array.from(
    new Set((uids ?? []).filter(Boolean).map(x => String(x).trim()).filter(Boolean))
  );

  if (!ids.length) return of({});

  return this.discoveryQuery.getProfilesByUids$(ids, { cacheTTL: 30_000 }).pipe(
    map((users) => {
      const out: Record<string, UserPublic> = {};

      for (const u of users ?? []) {
        if (!u?.uid) continue;

        out[u.uid] = {
          uid: u.uid,
          nickname:
            (u as any)?.nickname ??
            (u as any)?.displayName ??
            (u as any)?.name ??
            undefined,
          avatarUrl:
            (u as any)?.photoURL ??
            (u as any)?.avatarUrl ??
            (u as any)?.imageUrl ??
            undefined,
        };

        /**
         * Mantém a mesma estratégia anterior:
         * padroniza passagem pelo cache/state local para UX consistente.
         */
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

/**
 * Perfil público por UID.
 *
 * Uso:
 * - páginas de perfil de terceiros
 * - modais/cards públicos
 *
 * Não consulta /users.
 * Consulta /public_profiles via discovery.
 */
getPublicUserById$(uid: string): Observable<IUserDados | null> {
  const id = (uid ?? '').trim();
  if (!id) return of(null);

  return this.discoveryQuery.getProfilesByUids$([id], { cacheTTL: 30_000 }).pipe(
    map((profiles) => {
      const first = Array.isArray(profiles) ? profiles[0] ?? null : null;
      if (first) {
        this.userStateCache.upsertUser(first);
      }
      return first;
    }),
    catchError((err) => {
      this.firestoreError.handleFirestoreError(err);
      return of(null);
    })
  );
}

  // ============================================================
  // Exists (server)
  // ============================================================
  async checkUserExistsFromServer(uid: string): Promise<boolean> {
    return this.userRepo.checkUserExistsFromServer(uid);
  }

  // ============================================================
  // DONO oficial: snapshot determinístico
  // ============================================================
  /**
   * @deprecated Use UserRepositoryService.getUser$
   */
  getUserOnce$(uid: string): Observable<IUserDados | null> {
    return this.userRepo.getUser$(uid);
  }

  /**
   * Mantém nome "getUser$" para chamadas antigas que esperam "$".
   * (semântica: snapshot determinístico)
   */
  getUser$(uid: string): Observable<IUserDados | null> {
    return this.userRepo.getUser$(uid);
  }

  /**
   * @deprecated Use UserRepositoryService.getUserById$ (alias do getUser$)
   */
  getUserById$(uid: string): Observable<IUserDados | null> {
    return this.userRepo.getUserById$(uid);
  }

  /**
   * @deprecated Use UserRepositoryService.getUserById (alias do getUser$)
   */
  getUserById(uid: string): Observable<IUserDados | null> {
    return this.userRepo.getUserById(uid);
  }

  // ============================================================
  // DONO oficial: realtime
  // ============================================================
  /**
   * @deprecated Use UserRepositoryService.watchUser$
   * Mantém o nome getUser(uid) que existia como realtime.
   */
  getUser(uid: string): Observable<IUserDados | null> {
    return this.userRepo.watchUser$(uid);
  }

  /**
   * Alias explícito (realtime) para reduzir ambiguidade em chamadas novas.
   */
  observeUser$(uid: string): Observable<IUserDados | null> {
    return this.userRepo.watchUser$(uid);
  }

  /**
   * @deprecated Use getUser(uid) ou observeUser$(uid)
   */
  getUserWithObservable(uid: string): Observable<IUserDados | null> {
    return this.getUser(uid);
  }

  // ============================================================
  // One-shot direto do Firestore (sem cache/store) - útil em casos pontuais
  // ============================================================
  getUserOnceFromFirestore$(uid: string): Observable<IUserDados | null> {
    const id = (uid ?? '').trim();
    if (!id) return of(null);
    return this.usersReadRepo.getUserOnce$(id);
  }

  // ============================================================
  // Cache/Store helpers (delegam para o DONO)
  // ============================================================
  invalidateUserCache(uid: string): void {
    this.userRepo.invalidateUserCache(uid);
  }

  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    this.userRepo.updateUserInStateAndCache(uid, updatedData);
  }

  // ============================================================
  // Deleted watcher (mantém)
  // ============================================================
  watchUserDocDeleted$(uid: string): Observable<boolean> {
    return this.userRepo.watchUserDocDeleted$(uid);
  }
}
