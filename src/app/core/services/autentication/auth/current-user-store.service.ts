// src/app/core/services/autentication/auth/current-user-store.service.ts
// Serviço para gerenciar o estado do usuário atual (IUserDados)
// - “Source of truth” da SESSÃO: AuthSessionService (uid$, ready$, emailVerified$)
// - “Source of truth” do PERFIL (domínio): CurrentUserStoreService (user$ tri-state)
//
// Objetivo (padrão “plataformas grandes”):
// - Separar sessão (Auth) de perfil (Firestore/IUserDados).
// - Evitar decisões prematuras no bootstrap (cold start/refresh).
// - Evitar “purge” indevido de cache antes do Firebase resolver o UID.
// - Manter compatibilidade com chaves legadas (currentUser/currentUserUid) sem criar dependência disso.
//
// NÃO faz:
// - NÃO consulta Firestore diretamente (isso é do FirestoreUserQueryService / repositories).
//
// Debug:
// - Logs controlados por environment (dev only).

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { distinctUntilChanged, map, take } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { AuthSessionService } from './auth-session.service';
import { Auth } from '@angular/fire/auth';
import { environment } from 'src/environments/environment';

type UserTriState = IUserDados | null | undefined;

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  // ---------------------------------------------------------------------------
  // Keys (compat)
  // ---------------------------------------------------------------------------
  // Mantemos estas chaves porque sua plataforma já usa:
  // - CacheService (HOT_KEYS) espelha em localStorage e serve para bootstrap síncrono.
  // - Alguns fluxos antigos podem ler currentUserUid.
  private readonly keyUser = 'currentUser';
  private readonly keyUid = 'currentUserUid';

  // ---------------------------------------------------------------------------
  // State (tri-state)
  // ---------------------------------------------------------------------------
  // undefined: ainda não hidratou (bootstrap)
  // null: deslogado (sessão nula resolvida)
  // IUserDados: logado e perfil hidratado
  private readonly userSubject = new BehaviorSubject<UserTriState>(undefined);
  readonly user$: Observable<UserTriState> = this.userSubject.asObservable();

  // ---------------------------------------------------------------------------
  // Debug helpers
  // ---------------------------------------------------------------------------
  private readonly debug = !environment.production;

  constructor(
    private readonly cache: CacheService,
    private readonly authSession: AuthSessionService,
    private readonly auth: Auth, // usado apenas para snapshot/restore defensivo
  ) { }

  // ---------------------------------------------------------------------------
  // Public API — Perfil (IUserDados)
  // ---------------------------------------------------------------------------

  /**
   * set()
   * - Atualiza o estado do perfil (IUserDados) em memória (BehaviorSubject)
   * - Mantém “compat keys” (currentUser/currentUserUid) para bootstrap rápido
   * - Não persiste em IndexedDB por padrão (estado “vivo” de sessão)
   *
   * Quando chamar:
   * - Depois de buscar IUserDados no Firestore (ou cache) com uid já conhecido.
   */
  set(user: IUserDados): void {
    if (!user?.uid) return;

    const current = this.userSubject.value;
    if (current && current !== null && this.safeJsonEqual(current, user)) return;

    this.userSubject.next(user);

    // ✅ centraliza o write: CacheService espelha HOT_KEYS no localStorage
    // e mantém memória (além de permitir persist=false).
    this.cache.set(this.keyUser, user, undefined, { persist: false });
    this.cache.set(this.keyUid, user.uid, undefined, { persist: false });

    this.dbg('set(user)', { uid: user.uid });
  }

  /**
   * patch()
   * - Atualiza parcialmente o currentUser (sem “perder” campos já presentes).
   * - Útil quando chegam atualizações incrementais (ex.: isOnline, avatarUrl, etc.).
   */
  patch(partial: Partial<IUserDados>): void {
    const cur = this.userSubject.value;
    if (!cur || cur === null) return;

    const next: IUserDados = { ...cur, ...partial } as IUserDados;
    if (!next?.uid) return;

    if (this.safeJsonEqual(cur, next)) return;

    this.userSubject.next(next);
    this.cache.set(this.keyUser, next, undefined, { persist: false });

    // se patch trouxer uid (não deveria mudar), garantimos compat
    this.cache.set(this.keyUid, next.uid, undefined, { persist: false });

    this.dbg('patch(user)', { uid: next.uid, keys: Object.keys(partial ?? {}) });
  }

  /**
   * clear()
   * - Marca como deslogado (null)
   * - Remove compat keys
   *
   * Quando chamar:
   * - Logout
   * - Sessão encerrada (uid -> null) detectada no orquestrador/effects
   */
  clear(): void {
    if (this.userSubject.value === null) return;

    this.userSubject.next(null);

    // remove localStorage (HOT_KEYS) + memória + IndexedDB best-effort
    this.cache.delete(this.keyUser);
    this.cache.delete(this.keyUid);

    this.dbg('clear()');
  }

  /**
   * markUnhydrated()
   * - Volta o estado para undefined (ex.: antes de iniciar uma hidratação nova)
   * - Útil em “troca de conta” quando você quer bloquear UI até re-hidratar.
   *
   * Observação: não mexe em cache — isso é intencional.
   */
  markUnhydrated(): void {
    if (this.userSubject.value === undefined) return;
    this.userSubject.next(undefined);
    this.dbg('markUnhydrated()');
  }

  /**
   * getSnapshot()
   * - Retorna o valor atual do tri-state (sem Observable).
   */
  getSnapshot(): UserTriState {
    return this.userSubject.value;
  }

  /**
   * isHydratedOnce$()
   * - Emite 1x quando sair do estado “undefined”.
   * - Útil para componentes que precisam esperar hidratação, mas não querem “ready” de auth.
   */
  isHydratedOnce$(): Observable<boolean> {
    return this.user$.pipe(
      map(v => v !== undefined),
      distinctUntilChanged(),
      take(1)
    );
  }

  // ---------------------------------------------------------------------------
  // Public API — Sessão (AuthSession)
  // ---------------------------------------------------------------------------

  /**
   * AUTH READY (fonte: AuthSession)
   * - Indica que o Firebase/Auth já resolveu o estado inicial (cold start).
   * - Guards e bootstraps devem aguardar ready=true antes de decidir.
   */
  getAuthReady$(): Observable<boolean> {
    return this.authSession.ready$.pipe(distinctUntilChanged());
  }

  /**
   * UID (fonte: AuthSession)
   * - Esta é a fonte de verdade para uid.
   */
  getLoggedUserUID$(): Observable<string | null> {
    return this.authSession.uid$.pipe(distinctUntilChanged());
  }

  /**
   * Snapshot do UID
   * - Preferência:
   *   1) auth.currentUser.uid (quando já disponível)
   *   2) local cache (HOT_KEY)
   *   3) userSubject (perfil hidratado)
   */
  getLoggedUserUIDSnapshot(): string | null {
    return (
      this.auth.currentUser?.uid ??
      this.cache.getSync<string>(this.keyUid) ??
      (this.userSubject.value && this.userSubject.value !== null ? this.userSubject.value.uid : null) ??
      null
    );
  }

  /**
   * getLoggedUserUIDOnce$()
   * - Snapshot reativo 1x (útil em effects/guards para “decidir”).
   */
  getLoggedUserUIDOnce$(): Observable<string | null> {
    return this.getLoggedUserUID$().pipe(take(1));
  }

  // ---------------------------------------------------------------------------
  // Restore (compat) — corrigido para não “purge cedo”
  // ---------------------------------------------------------------------------

  /**
   * restoreFromCache()
   * - Restaura o currentUser do cache (HOT_KEY) SOMENTE se:
   *   - authUid existe (Auth já resolveu) e
   *   - cached.uid === authUid
   *
   * Importante:
   * - Se authUid ainda não existe (bootstrap), NÃO apaga nada.
   * - Só faz purge quando existe authUid e há divergência (stale cross-user).
   *
   * Quando chamar:
   * - Depois de ready=true (ex.: no bootstrap orchestrator/effect).
   */
  restoreFromCache(): IUserDados | null {
    const authUid = this.auth.currentUser?.uid ?? null;

    // ✅ não decida/purge sem authUid: evita apagar cache durante bootstrap
    if (!authUid) {
      this.dbg('restoreFromCache() -> skip (no authUid yet)');
      return null;
    }

    const cached = this.cache.getSync<IUserDados>(this.keyUser);

    if (cached?.uid && cached.uid === authUid) {
      this.userSubject.next(cached);
      this.cache.set(this.keyUid, authUid, undefined, { persist: false });
      this.dbg('restoreFromCache() -> restored', { uid: authUid });
      return cached;
    }

    // stale: existe cache mas pertence a outro uid → purge
    if (cached?.uid && cached.uid !== authUid) {
      this.cache.delete(this.keyUser);
      this.cache.delete(this.keyUid);
      this.dbg('restoreFromCache() -> purged stale cache', { cachedUid: cached.uid, authUid });
    } else {
      this.dbg('restoreFromCache() -> nothing to restore', { authUid });
    }

    return null;
  }

  /**
   * restoreFromCacheWhenReady$()
   * - Conveniência para bootstrap:
   *   aguarda ready=true e tenta restore 1x.
   *
   * Útil para chamar no AppComponent/initializer/orchestrator.
   */
  restoreFromCacheWhenReady$(): Observable<IUserDados | null> {
    return this.getAuthReady$().pipe(
      take(1),
      map(() => this.restoreFromCache())
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private safeJsonEqual(a: unknown, b: unknown): boolean {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[CurrentUserStore] ${message}`, extra ?? '');
  }
}

/**
 * Resumo mental (padrão “plataforma grande”):
 *
 * - AuthSessionService: manda no UID/ready/emailVerified (sessão)
 * - CurrentUserStoreService: manda no IUserDados (perfil)
 * - FirestoreUserQueryService (ou repo): busca IUserDados por uid
 * - Effects/Orchestrator: liga as coisas:
 *    - quando uid muda, tenta restore -> se não tiver, busca Firestore -> set()
 *    - quando uid vira null, clear()
 *
 * “Qualquer UID fora disso” deve ser visto como compat/derivado.
 */
/*
src/app/core/services/autentication/auth/auth-session.service.ts
src/app/core/services/autentication/auth/current-user-store.service.ts
src/app/core/services/autentication/auth/auth-orchestrator.service.ts
src/app/core/services/autentication/auth/auth.facade.ts
src/app/core/services/autentication/auth/logout.service.ts
*/
