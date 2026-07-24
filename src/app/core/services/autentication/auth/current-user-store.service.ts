// src/app/core/services/autentication/auth/current-user-store.service.ts
// Estado runtime do usuário atual.
//
// Fonte de verdade:
// - sessão/UID: AuthSessionService;
// - perfil runtime: CurrentUserStoreService;
// - perfil persistente: Firestore pelo fluxo AuthSessionSyncEffects + UserEffects.
//
// Tri-state:
// - undefined: hidratação em andamento;
// - null: perfil indisponível no runtime atual;
// - IUserDados: perfil carregado.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDA a escrita do objeto completo em `currentUser`/localStorage.
//   Motivo: perfil, e-mail, assinatura, moderação e demais atributos privados não
//   devem permanecer serializados no navegador por conveniência de bootstrap.
// - SUPRIMIDA a restauração do perfil completo por `restoreFromCache*()`.
//   Motivo: esses métodos criavam uma segunda fonte de verdade potencialmente
//   stale. As nomenclaturas foram preservadas por compatibilidade, mas agora
//   apenas saneiam o legado e retornam null.
//
// Mantido:
// - `currentUserUid` como compatibilidade mínima de leitura síncrona;
// - API Observable-first e métodos públicos existentes;
// - hidratação oficial via Store/Effects/Firestore.
import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  take,
} from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { AuthSessionService } from './auth-session.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

type UserTriState = IUserDados | null | undefined;

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  private readonly legacyKeyUser = 'currentUser';
  private readonly keyUid = 'currentUserUid';

  private readonly userSubject =
    new BehaviorSubject<UserTriState>(undefined);

  readonly user$: Observable<UserTriState> =
    this.userSubject.asObservable();

  constructor(
    private readonly cache: CacheService,
    private readonly authSession: AuthSessionService,
    private readonly auth: Auth,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {
    // Saneamento idempotente de instalações que ainda possuem perfil completo.
    this.cache.delete(this.legacyKeyUser);
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log(
      'profile',
      `CurrentUserStore: ${message}`,
      extra
    );
  }

  /** Runtime resolvido com perfil válido. */
  set(user: IUserDados): void {
    if (!user?.uid) return;

    const current = this.userSubject.value;
    if (
      current &&
      current !== null &&
      this.areUsersEquivalent(current, user)
    ) {
      return;
    }

    this.userSubject.next(user);
    this.cache.set(this.keyUid, user.uid, undefined, {
      persist: false,
    });

    this.dbg('set(user)', { uid: user.uid });
  }

  patch(partial: Partial<IUserDados>): void {
    const current = this.userSubject.value;
    if (!current || current === null) return;

    const next = { ...current, ...partial } as IUserDados;
    if (!next?.uid) return;
    if (this.areUsersEquivalent(current, next)) return;

    this.userSubject.next(next);
    this.cache.set(this.keyUid, next.uid, undefined, {
      persist: false,
    });

    this.dbg('patch(user)', {
      uid: next.uid,
      keys: Object.keys(partial ?? {}),
    });
  }

  /**
   * Sessão pode continuar existindo, mas o perfil ficou indisponível.
   * Não é logout e o UID do Auth pode continuar sendo mantido.
   */
  setUnavailable(): void {
    if (this.userSubject.value !== null) {
      this.userSubject.next(null);
    }

    this.cache.delete(this.legacyKeyUser);

    const authUid =
      this.authSession.currentAuthUser?.uid ??
      this.auth.currentUser?.uid ??
      null;

    if (authUid) {
      this.cache.set(this.keyUid, authUid, undefined, {
        persist: false,
      });
    } else {
      this.cache.delete(this.keyUid);
    }

    this.dbg('setUnavailable()', { authUid });
  }

  /** Estado resolvido sem usuário; usado em logout/sessão nula. */
  clear(): void {
    if (this.userSubject.value !== null) {
      this.userSubject.next(null);
    }

    this.cache.delete(this.legacyKeyUser);
    this.cache.delete(this.keyUid);

    this.dbg('clear()');
  }

  /** Estado transitório enquanto o perfil do UID está sendo resolvido. */
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

  /**
   * Compatibilidade mantida: não restaura perfil do navegador.
   * O perfil será hidratado pelo fluxo oficial do Store/Firestore.
   */
  restoreFromCache(): IUserDados | null {
    const uid =
      this.authSession.currentAuthUser?.uid ??
      this.auth.currentUser?.uid ??
      null;

    return this.restoreFromCacheForUid(uid);
  }

  /**
   * Compatibilidade mantida: saneia `currentUser` legado e preserva somente UID.
   */
  restoreFromCacheForUid(
    uid: string | null | undefined
  ): IUserDados | null {
    const authUid = String(uid ?? '').trim();

    this.cache.delete(this.legacyKeyUser);

    if (!authUid) {
      this.dbg('restoreFromCacheForUid() -> skip (no uid)');
      return null;
    }

    this.cache.set(this.keyUid, authUid, undefined, {
      persist: false,
    });

    this.dbg('restoreFromCacheForUid() -> legacy profile suppressed', {
      uid: authUid,
    });

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
}
