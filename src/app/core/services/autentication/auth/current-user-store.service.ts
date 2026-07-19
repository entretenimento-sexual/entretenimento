// src/app/core/services/autentication/auth/current-user-store.service.ts
// Serviço para gerenciar o estado do usuário atual (IUserDados)
//
// Source of truth:
// - Sessão/Auth/UID: AuthSessionService
// - Perfil do app (runtime): CurrentUserStoreService
//
// Tri-state:
// - undefined: hidratação em andamento / ainda não resolvido
// - null: perfil indisponível no runtime atual
// - IUserDados: perfil carregado
//
// Observação:
// - Este serviço NÃO consulta Firestore.
// - Ele só mantém o runtime do perfil e faz bootstrap compatível por HOT_KEYS.
// - Perfil runtime do app: fluxo oficial AuthSessionSyncEffects + UserEffects + CurrentUserStoreService
// - este service NÃO escreve no perfil runtime do app.
import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, filter, map, take } from 'rxjs/operators';

import {
  IUserAdultConsent,
  IUserDados,
  IUserTermsAcceptance,
} from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { AuthSessionService } from './auth-session.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

type UserTriState = IUserDados | null | undefined;

const RESTRICTED_ACCOUNT_STATUSES = new Set([
  'self_suspended',
  'moderation_suspended',
  'pending_deletion',
  'deleted',
  'suspended',
  'locked',
]);

/**
 * Defesa de runtime para todas as origens de autenticação.
 *
 * O backend e as Rules continuam sendo a autoridade. Esta normalização impede
 * que seeds locais, respostas temporárias de login social ou cache legado
 * representem uma conta incompleta/restrita como pública antes da hidratação
 * canônica terminar.
 */
export function normalizeCurrentUserRuntimeVisibility(
  user: IUserDados
): IUserDados {
  const status = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();
  const profileIncomplete = user.profileCompleted !== true;
  const lifecycleRestricted =
    RESTRICTED_ACCOUNT_STATUSES.has(status) ||
    user.suspended === true ||
    user.accountLocked === true;

  if (!profileIncomplete && !lifecycleRestricted) {
    return user;
  }

  if (
    user.publicVisibility === 'hidden' &&
    user.interactionBlocked === true
  ) {
    return user;
  }

  return {
    ...user,
    publicVisibility: 'hidden',
    interactionBlocked: true,
  } as IUserDados;
}

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  private readonly keyUser = 'currentUser';
  private readonly keyUid = 'currentUserUid';

  private readonly userSubject = new BehaviorSubject<UserTriState>(undefined);
  readonly user$: Observable<UserTriState> = this.userSubject.asObservable();

  constructor(
    private readonly cache: CacheService,
    private readonly authSession: AuthSessionService,
    private readonly auth: Auth,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  /**
   * Debug seguro do runtime do usuário atual.
   *
   * Canal:
   * localStorage.setItem('DEBUG_PROFILE', '1');
   *
   * Este service lida com:
   * - UID autenticado;
   * - perfil runtime;
   * - cache de currentUser/currentUserUid;
   * - estado tri-state do usuário atual.
   *
   * Por isso, não deve usar console.log direto.
   */
  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('profile', `CurrentUserStore: ${message}`, extra);
  }

  // ---------------------------------------------------------------------------
  // Perfil runtime
  // ---------------------------------------------------------------------------

  /**
   * set()
   * - runtime resolvido com perfil válido
   */
  set(user: IUserDados): void {
    if (!user?.uid) return;

    const safeUser = normalizeCurrentUserRuntimeVisibility(user);
    const current = this.userSubject.value;
    if (
      current &&
      current !== null &&
      this.areUsersEquivalent(current, safeUser)
    ) {
      return;
    }

    this.userSubject.next(safeUser);

    /**
     * Compat hot keys:
     * - leitura síncrona no bootstrap
     * - não são fonte primária do perfil
     */
    this.cache.set(this.keyUser, safeUser, undefined, { persist: false });
    this.cache.set(this.keyUid, safeUser.uid, undefined, { persist: false });

    this.dbg('set(user)', {
      uid: safeUser.uid,
      normalizedVisibility: safeUser !== user,
    });
  }

  patch(partial: Partial<IUserDados>): void {
    const current = this.userSubject.value;
    if (!current || current === null) return;

    const merged = { ...current, ...partial } as IUserDados;
    const next = normalizeCurrentUserRuntimeVisibility(merged);
    if (!next?.uid) return;
    if (this.areUsersEquivalent(current, next)) return;

    this.userSubject.next(next);
    this.cache.set(this.keyUser, next, undefined, { persist: false });
    this.cache.set(this.keyUid, next.uid, undefined, { persist: false });

    this.dbg('patch(user)', {
      uid: next.uid,
      keys: Object.keys(partial ?? {}),
      normalizedVisibility: next !== merged,
    });
  }

  /**
   * setUnavailable()
   * - sessão pode continuar existindo
   * - mas o perfil do app ficou indisponível neste ciclo
   *
   * Importante:
   * - não é logout
   * - não deve manter currentUser stale no HOT_KEY
   * - uid compatível pode continuar existindo se a sessão auth ainda existir
   */
  setUnavailable(): void {
    const current = this.userSubject.value;
    if (current !== null) {
      this.userSubject.next(null);
    }

    this.cache.delete(this.keyUser);

    const authUid =
      this.authSession.currentAuthUser?.uid ??
      this.auth.currentUser?.uid ??
      null;

    if (authUid) {
      this.cache.set(this.keyUid, authUid, undefined, { persist: false });
    } else {
      this.cache.delete(this.keyUid);
    }

    this.dbg('setUnavailable()', { authUid });
  }

  /**
   * clear()
   * - estado resolvido sem usuário
   * - usado em logout / sessão nula confirmada
   */
  clear(): void {
    if (this.userSubject.value === null) {
      this.cache.delete(this.keyUser);
      this.cache.delete(this.keyUid);
      return;
    }

    this.userSubject.next(null);
    this.cache.delete(this.keyUser);
    this.cache.delete(this.keyUid);

    this.dbg('clear()');
  }

  /**
   * markUnhydrated()
   * - estado transitório
   * - usado quando há UID, mas o perfil ainda está sendo resolvido
   */
  markUnhydrated(): void {
    if (this.userSubject.value === undefined) return;
    this.userSubject.next(undefined);
    this.dbg('markUnhydrated()');
  }

  getSnapshot(): UserTriState {
    return this.userSubject.value;
  }

  isHydratedOnce$(): Observable<boolean> {
    return this.user$.pipe(
      map((value) => value !== undefined),
      distinctUntilChanged(),
      filter((hydrated) => hydrated === true),
      take(1)
    );
  }

  isResolved$(): Observable<boolean> {
    return this.user$.pipe(
      map((value) => value !== undefined),
      distinctUntilChanged()
    );
  }

  hasProfile$(): Observable<boolean> {
    return this.user$.pipe(
      map((value) => value !== undefined && value !== null),
      distinctUntilChanged()
    );
  }

  // ---------------------------------------------------------------------------
  // Sessão/Auth
  // ---------------------------------------------------------------------------

  getAuthReady$(): Observable<boolean> {
    return this.authSession.ready$.pipe(distinctUntilChanged());
  }

  getLoggedUserUID$(): Observable<string | null> {
    return this.authSession.uid$.pipe(distinctUntilChanged());
  }

  getLoggedUserUIDSnapshot(): string | null {
    return (
      this.auth.currentUser?.uid ??
      this.cache.getSync<string>(this.keyUid) ??
      (this.userSubject.value && this.userSubject.value !== null
        ? this.userSubject.value.uid
        : null) ??
      null
    );
  }

  getLoggedUserUIDOnce$(): Observable<string | null> {
    return this.getLoggedUserUID$().pipe(take(1));
  }

  // ---------------------------------------------------------------------------
  // Restore compatível
  // ---------------------------------------------------------------------------

  restoreFromCache(): IUserDados | null {
    const uid =
      this.authSession.currentAuthUser?.uid ??
      this.auth.currentUser?.uid ??
      null;

    return this.restoreFromCacheForUid(uid);
  }

  restoreFromCacheForUid(uid: string | null | undefined): IUserDados | null {
    const authUid = (uid ?? '').trim();
    if (!authUid) {
      this.dbg('restoreFromCacheForUid() -> skip (no uid)');
      return null;
    }

    const cached = this.cache.getSync<IUserDados>(this.keyUser);

    if (cached?.uid && cached.uid === authUid) {
      const safeCached = normalizeCurrentUserRuntimeVisibility(cached);
      const current = this.userSubject.value;
      if (
        !(
          current &&
          current !== null &&
          this.areUsersEquivalent(current, safeCached)
        )
      ) {
        this.userSubject.next(safeCached);
      }

      if (safeCached !== cached) {
        this.cache.set(this.keyUser, safeCached, undefined, {
          persist: false,
        });
      }

      this.cache.set(this.keyUid, authUid, undefined, { persist: false });
      this.dbg('restoreFromCacheForUid() -> restored', {
        uid: authUid,
        normalizedVisibility: safeCached !== cached,
      });
      return safeCached;
    }

    if (cached?.uid && cached.uid !== authUid) {
      this.cache.delete(this.keyUser);
      this.cache.delete(this.keyUid);
      this.dbg('restoreFromCacheForUid() -> purged stale cache', {
        cachedUid: cached.uid,
        authUid,
      });
    } else {
      this.dbg('restoreFromCacheForUid() -> nothing to restore', {
        authUid,
      });
    }

    return null;
  }

  restoreFromCacheWhenReady$(): Observable<IUserDados | null> {
    return this.getAuthReady$().pipe(
      filter((ready) => ready === true),
      take(1),
      map(() => this.restoreFromCache())
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private areTermsAcceptancesEquivalent(
    current: IUserTermsAcceptance | null | undefined,
    incoming: IUserTermsAcceptance | null | undefined
  ): boolean {
    if (current === incoming) return true;
    if (!current && !incoming) return true;
    if (!current || !incoming) return false;

    return (
      current.accepted === incoming.accepted &&
      current.date === incoming.date &&
      current.version === incoming.version &&
      current.acceptedAt === incoming.acceptedAt &&
      current.updatedAt === incoming.updatedAt &&
      current.source === incoming.source
    );
  }

  private areAdultConsentsEquivalent(
    current: IUserAdultConsent | null | undefined,
    incoming: IUserAdultConsent | null | undefined
  ): boolean {
    if (current === incoming) return true;
    if (!current && !incoming) return true;
    if (!current || !incoming) return false;

    return (
      current.accepted === incoming.accepted &&
      current.version === incoming.version &&
      current.acceptedAt === incoming.acceptedAt &&
      current.updatedAt === incoming.updatedAt &&
      current.source === incoming.source
    );
  }

  private areUsersEquivalent(
    current: IUserDados | null | undefined,
    incoming: IUserDados | null | undefined
  ): boolean {
    if (current === incoming) return true;
    if (!current && !incoming) return true;
    if (!current || !incoming) return false;

    return (
      current.uid === incoming.uid &&
      current.nickname === incoming.nickname &&
      current.email === incoming.email &&
      current.emailVerified === incoming.emailVerified &&
      current.photoURL === incoming.photoURL &&
      current.role === incoming.role &&
      current.tier === incoming.tier &&
      current.profileCompleted === incoming.profileCompleted &&
      current.isSubscriber === incoming.isSubscriber &&
      current.subscriptionStatus === incoming.subscriptionStatus &&
      this.areTermsAcceptancesEquivalent(
        current.acceptedTerms,
        incoming.acceptedTerms
      ) &&
      this.areAdultConsentsEquivalent(
        current.adultConsent,
        incoming.adultConsent
      ) &&

      // lifecycle / moderação
      current.accountStatus === incoming.accountStatus &&
      current.suspended === incoming.suspended &&
      current.publicVisibility === incoming.publicVisibility &&
      current.interactionBlocked === incoming.interactionBlocked &&
      current.loginAllowed === incoming.loginAllowed &&
      current.statusUpdatedAt === incoming.statusUpdatedAt &&
      current.statusUpdatedBy === incoming.statusUpdatedBy &&
      current.suspensionReason === incoming.suspensionReason &&
      current.suspensionSource === incoming.suspensionSource &&
      current.suspensionEndsAt === incoming.suspensionEndsAt &&
      current.deletionRequestedAt === incoming.deletionRequestedAt &&
      current.deletionRequestedBy === incoming.deletionRequestedBy &&
      current.deletionUndoUntil === incoming.deletionUndoUntil &&
      current.purgeAfter === incoming.purgeAfter &&
      current.deletedAt === incoming.deletedAt
    );
  }
} // fim do current-user-store.service.ts
