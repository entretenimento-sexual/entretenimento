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
//* - este service NÃO escreve no perfil runtime do app.
//* - o perfil continua sob a fonte única:
//*   AuthSessionSyncEffects + UserEffects + CurrentUserStoreService
import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, filter, map, take } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { AuthSessionService } from './auth-session.service';
import { environment } from 'src/environments/environment';

type UserTriState = IUserDados | null | undefined;

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  private readonly keyUser = 'currentUser';
  private readonly keyUid = 'currentUserUid';

  private readonly userSubject = new BehaviorSubject<UserTriState>(undefined);
  readonly user$: Observable<UserTriState> = this.userSubject.asObservable();

  private readonly debug = !environment.production;

  constructor(
    private readonly cache: CacheService,
    private readonly authSession: AuthSessionService,
    private readonly auth: Auth,
  ) {}

  // ---------------------------------------------------------------------------
  // Perfil runtime
  // ---------------------------------------------------------------------------

  /**
   * set()
   * - runtime resolvido com perfil válido
   */
  set(user: IUserDados): void {
    if (!user?.uid) return;

    const current = this.userSubject.value;
    if (current && current !== null && this.areUsersEquivalent(current, user)) {
      return;
    }

    this.userSubject.next(user);

    /**
     * Compat hot keys:
     * - leitura síncrona no bootstrap
     * - não são fonte primária do perfil
     */
    this.cache.set(this.keyUser, user, undefined, { persist: false });
    this.cache.set(this.keyUid, user.uid, undefined, { persist: false });

    this.dbg('set(user)', { uid: user.uid });
  }

  patch(partial: Partial<IUserDados>): void {
    const current = this.userSubject.value;
    if (!current || current === null) return;

    const next = { ...current, ...partial } as IUserDados;
    if (!next?.uid) return;
    if (this.areUsersEquivalent(current, next)) return;

    this.userSubject.next(next);
    this.cache.set(this.keyUser, next, undefined, { persist: false });
    this.cache.set(this.keyUid, next.uid, undefined, { persist: false });

    this.dbg('patch(user)', {
      uid: next.uid,
      keys: Object.keys(partial ?? {}),
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
      const current = this.userSubject.value;
      if (!(current && current !== null && this.areUsersEquivalent(current, cached))) {
        this.userSubject.next(cached);
      }

      this.cache.set(this.keyUid, authUid, undefined, { persist: false });
      this.dbg('restoreFromCacheForUid() -> restored', { uid: authUid });
      return cached;
    }

    if (cached?.uid && cached.uid !== authUid) {
      this.cache.delete(this.keyUser);
      this.cache.delete(this.keyUid);
      this.dbg('restoreFromCacheForUid() -> purged stale cache', {
        cachedUid: cached.uid,
        authUid,
      });
    } else {
      this.dbg('restoreFromCacheForUid() -> nothing to restore', { authUid });
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

  private areUsersEquivalent(
    a: IUserDados | null | undefined,
    b: IUserDados | null | undefined,
  ): boolean {
    if (a === b) return true;
    if (!a || !b) return false;

    return (
      a.uid === b.uid &&
      a.email === b.email &&
      a.emailVerified === b.emailVerified &&
      a.nickname === b.nickname &&
      a.profileCompleted === b.profileCompleted &&
      a.role === b.role
    );
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[CurrentUserStore] ${message}`, extra ?? '');
  }
} // Linha 304, fim do current-user-store.service.ts
// Verificar migrações de responsabilidades para o:
// 1 - auth-route-context.service.ts, e;
// 2 - auth-user-document-watch.service.ts, e;
// 3 - auth-session-monitor.service.ts.
