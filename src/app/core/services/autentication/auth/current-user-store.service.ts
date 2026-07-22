// src/app/core/services/autentication/auth/current-user-store.service.ts
// Serviço tri-state do usuário atual.
//
// Source of truth:
// - sessão/UID: AuthSessionService;
// - perfil runtime: CurrentUserStoreService;
// - Firestore é observado pelos effects, não por este serviço.
//
// A equivalência considera o objeto serializável completo. Isso impede que
// campos novos — especialmente versão e período de assinatura — sejam
// descartados por um comparador manual desatualizado.
import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, filter, map, take } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
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

/** Defesa de runtime para todas as origens de autenticação. */
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

  if (!profileIncomplete && !lifecycleRestricted) return user;

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

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('profile', `CurrentUserStore: ${message}`, extra);
  }

  set(user: IUserDados): void {
    if (!user?.uid) return;

    const safeUser = normalizeCurrentUserRuntimeVisibility(user);
    const current = this.userSubject.value;
    if (this.areUsersEquivalent(current, safeUser)) return;

    this.userSubject.next(safeUser);
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
    if (!next.uid || this.areUsersEquivalent(current, next)) return;

    this.userSubject.next(next);
    this.cache.set(this.keyUser, next, undefined, { persist: false });
    this.cache.set(this.keyUid, next.uid, undefined, { persist: false });

    this.dbg('patch(user)', {
      uid: next.uid,
      keys: Object.keys(partial ?? {}),
      normalizedVisibility: next !== merged,
    });
  }

  setUnavailable(): void {
    if (this.userSubject.value !== null) {
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

  clear(): void {
    if (this.userSubject.value !== null) {
      this.userSubject.next(null);
    }

    this.cache.delete(this.keyUser);
    this.cache.delete(this.keyUid);
    this.dbg('clear()');
  }

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

  restoreFromCache(): IUserDados | null {
    const uid =
      this.authSession.currentAuthUser?.uid ??
      this.auth.currentUser?.uid ??
      null;

    return this.restoreFromCacheForUid(uid);
  }

  restoreFromCacheForUid(
    uid: string | null | undefined
  ): IUserDados | null {
    const authUid = String(uid ?? '').trim();
    if (!authUid) {
      this.dbg('restoreFromCacheForUid() -> skip (no uid)');
      return null;
    }

    const cached = this.cache.getSync<IUserDados>(this.keyUser);

    if (cached?.uid === authUid) {
      const safeCached = normalizeCurrentUserRuntimeVisibility(cached);

      if (!this.areUsersEquivalent(this.userSubject.value, safeCached)) {
        this.userSubject.next(safeCached);
      }

      if (!this.areUsersEquivalent(cached, safeCached)) {
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

  private areUsersEquivalent(
    current: IUserDados | null | undefined,
    incoming: IUserDados | null | undefined
  ): boolean {
    if (current === incoming) return true;
    if (!current && !incoming) return true;
    if (!current || !incoming) return false;

    try {
      return this.stableSerialize(current) === this.stableSerialize(incoming);
    } catch {
      return false;
    }
  }

  private stableSerialize(value: unknown): string {
    return JSON.stringify(this.sortSerializableValue(value));
  }

  private sortSerializableValue(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;

    if (Array.isArray(value)) {
      return value.map((item) => this.sortSerializableValue(item));
    }

    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      sorted[key] = this.sortSerializableValue(record[key]);
    }

    return sorted;
  }
}
