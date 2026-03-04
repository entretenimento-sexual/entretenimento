// src/app/core/services/autentication/auth/access-control.service.ts
// Serviço central de controle de acesso/capacidades (estilo “grandes plataformas”).
//
// Objetivo:
// - Derivar um estado único de acesso a partir de:
//   (1) AuthSessionService (verdade do Firebase Auth: uid, emailVerified, ready$)
//   (2) CurrentUserStoreService (verdade do app: role, profileCompleted, etc.)
//   (3) AuthAppBlockService (verdade do bloqueio do app: TerminateReason | null)
//   (4) Router (estado de navegação e rotas “sensíveis” para gating)
// - Expor Observables simples para Guards e UI gating (menu, listeners realtime, writes).
// - Manter métodos existentes (hasAtLeast$, hasAny$) para não quebrar o projeto.
// - Erros: roteados para GlobalErrorHandlerService e ErrorNotificationService,
//   com degradação segura (nunca liberar acesso em caso de erro).
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  take,
  tap,
} from 'rxjs/operators';

import type { IUserDados } from '../../../interfaces/iuser-dados';
import type { TerminateReason } from './auth.types';

// ✅ helper canônico do projeto (evita regex duplicada em effects/serviços)
import { inRegistrationFlow as isRegistrationFlow } from './auth.types';

import { AuthSessionService } from './auth-session.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { AuthAppBlockService } from './auth-app-block.service';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

export type UserRole = IUserDados['role'];

export type AccessState =
  | 'GUEST'
  | 'AUTHED_PROFILE_INCOMPLETE'
  | 'AUTHED_PROFILE_COMPLETE_UNVERIFIED'
  | 'AUTHED_PROFILE_COMPLETE_VERIFIED';

/**
 * Ranking simples de role (para recursos premium etc.).
 * Obs.: se aparecer uma role “desconhecida”, degradamos para o menor nível (seguro).
 */
const ROLE_RANK: Record<string, number> = {
  visitante: 0,
  free: 1,
  basic: 2,
  premium: 3,
  vip: 4,
};

@Injectable({ providedIn: 'root' })
export class AccessControlService {
  // ---------------------------------------------------------------------------
  // DI (fields primeiro: tudo que os streams vão usar já existe)
  // ---------------------------------------------------------------------------
  private readonly router = inject(Router);

  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly appBlock = inject(AuthAppBlockService);

  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notify = inject(ErrorNotificationService);

  // Evita spam de notificação por falhas em streams (singleton)
  private _lastNotifyAt = 0;

  private readonly debug = !environment.production;
  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AccessControl] ${msg}`, extra ?? '');
  }

  private stripQueryAndHash(url: string): string {
    const raw = (url ?? '/').trim() || '/';
    const q = raw.indexOf('?');
    const h = raw.indexOf('#');
    const cut = Math.min(q === -1 ? raw.length : q, h === -1 ? raw.length : h);
    const path = raw.slice(0, cut);
    return path || '/';
  }

  // ---------------------------------------------------------------------------
  // Helpers (perfil mínimo / roles / erros)
  // ---------------------------------------------------------------------------

  private safeRank(role: unknown): number {
    const key = (role ?? 'visitante') as string;
    return ROLE_RANK[key] ?? ROLE_RANK['visitante'];
  }

  private safeRole(role: unknown): UserRole {
    const key = (role ?? 'visitante') as string;
    return (ROLE_RANK[key] != null ? key : 'visitante') as UserRole;
  }

  /** Fallback conservador de “perfil mínimo” (produto). */
  private hasMinProfileFields(anyU: any): boolean {
    // Aceita aliases comuns (não muda regra, só evita mismatch de naming)
    const gender = (anyU?.gender ?? anyU?.genero ?? anyU?.sexo) as unknown;
    const estado = (anyU?.estado ?? anyU?.state) as unknown;
    const municipio = (anyU?.municipio ?? anyU?.cidade ?? anyU?.city) as unknown;

    return (
      typeof gender === 'string' && gender.trim() !== '' &&
      typeof estado === 'string' && estado.trim() !== '' &&
      typeof municipio === 'string' && municipio.trim() !== ''
    );
  }

  /**
   * Roteia erro para o handler global e notifica com throttle.
   * Importante: fallback SEMPRE restritivo (false, null, 'GUEST', etc.)
   */
  private handleStreamError<T>(context: string, fallback: T): (err: unknown) => Observable<T> {
    return (err: unknown) => {
      const e = err instanceof Error ? err : new Error(`AccessControlService stream error: ${context}`);
      (e as any).silent = true;
      (e as any).original = err;
      (e as any).context = context;

      this.globalError.handleError(e);

      const now = Date.now();
      if (now - this._lastNotifyAt > 15_000) {
        this._lastNotifyAt = now;
        this.notify.showError('Falha ao validar acesso. Tente novamente.');
      }

      return of(fallback);
    };
  }

  // ---------------------------------------------------------------------------
  // Router signals (gate canônico de rota)
  // ---------------------------------------------------------------------------
  /** URL atual (replay) — agora CRUA (com query/hash se vierem) */
  readonly currentUrl$: Observable<string> = this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    map((e) => (e.urlAfterRedirects || e.url || '/')),
    startWith(this.router.url || '/'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('currentUrl$', this.router.url || '/'))
  );

  /** Router pronto após 1º NavigationEnd */
  readonly routerReady$: Observable<boolean> = this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    take(1),
    map(() => true),
    startWith(false),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('routerReady$', false))
  );

  // 1) URL canônica APÓS NavigationEnd (path-only)
  private readonly navPath$: Observable<string> = this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    map((e) => this.stripQueryAndHash(e.urlAfterRedirects || e.url || '/')),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('navPath$', this.stripQueryAndHash(this.router.url || '/')))
  );

  // 2) Fluxo sensível (registro/login) — sem race
  readonly inRegistrationFlow$: Observable<boolean> = this.navPath$.pipe(
    // seguro: até 1º NavigationEnd, bloqueia
    startWith('__BOOT__'),
    map((path) => {
      if (path === '__BOOT__') return true;

      if (isRegistrationFlow(path)) return true;
      if (/^\/login(\/|$)/.test(path)) return true;
      return false;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('inRegistrationFlow$', true))
  );

  // ---------------------------------------------------------------------------
  // Streams base (Auth + AppUser + Block) — precisam vir ANTES das derivações
  // ---------------------------------------------------------------------------

  /** Sessão pronta? (Auth restaurado) — evita decisões prematuras */
  readonly ready$: Observable<boolean> = this.session.ready$.pipe(
    startWith(false),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('ready$', false))
  );

  /** Firebase user (verdade do Auth) */
  readonly authUser$ = this.session.authUser$.pipe(
    startWith(null),
    distinctUntilChanged((a, b) =>
      (a?.uid ?? null) === (b?.uid ?? null) &&
      (a?.emailVerified ?? false) === (b?.emailVerified ?? false)
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('authUser$', null))
  );

  /** UID do Auth (verdade) */
  readonly authUid$: Observable<string | null> = this.authUser$.pipe(
    map(u => u?.uid ?? null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('authUid$', null))
  );

  /**
   * Usuário do app (Firestore/cache/store).
   * - undefined: ainda não resolvido (hidratação em andamento)
   * - null: não logado
   * - IUserDados: logado e perfil carregado
   */
  readonly appUser$ = this.currentUserStore.user$.pipe(
    startWith(undefined),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('appUser$', undefined))
  );

  /** Motivo do bloqueio do app (fonte única) */
  readonly blockedReason$: Observable<TerminateReason | null> = this.appBlock.reason$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('blockedReason$', null))
  );

  /** True quando o app está bloqueado */
  readonly isBlocked$: Observable<boolean> = this.blockedReason$.pipe(
    map(r => !!r),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isBlocked$', false))
  );

  // ---------------------------------------------------------------------------
  // Derivações de sessão / verificação / perfil
  // ---------------------------------------------------------------------------

  /** Está autenticado? (considera ready$ para evitar “piscar”) */
  readonly isAuthenticated$: Observable<boolean> = combineLatest([this.ready$, this.authUid$]).pipe(
    map(([ready, uid]) => !!ready && !!uid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isAuthenticated$', false))
  );

  /** Email verificado no Auth? (verdade do Auth) */
  readonly emailVerified$: Observable<boolean> = combineLatest([this.ready$, this.authUser$]).pipe(
    map(([ready, u]) => !!ready && !!u?.uid && u.emailVerified === true),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('emailVerified$', false))
  );

  /** Perfil completo no app? (verdade do domínio do app) */
  readonly profileCompleted$: Observable<boolean> = combineLatest([this.isAuthenticated$, this.appUser$]).pipe(
    map(([isAuth, u]) => {
      if (!isAuth) return false;
      if (u === undefined || u === null) return false; // carregando / sem user => nega
      return (u as any)?.profileCompleted === true;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('profileCompleted$', false))
  );

  /**
   * Perfil “elegível” (produto):
   * - profileCompleted === true
   *   OU fallback defensivo por campos mínimos.
   *
   * Conservador: se não dá pra provar, bloqueia.
   */
  readonly profileEligible$: Observable<boolean> = combineLatest([this.isAuthenticated$, this.appUser$]).pipe(
    map(([isAuth, u]) => {
      if (!isAuth) return false;
      if (u === undefined || u === null) return false;

      const anyU = u as any;

      if (!environment.production) {
        this.dbg('profileEligible inputs', {
          uid: anyU?.uid,
          profileCompleted: anyU?.profileCompleted,
          gender: anyU?.gender,
          estado: anyU?.estado,
          municipio: anyU?.municipio,
        });
      }

      if (anyU?.profileCompleted === true) return true;
      return this.hasMinProfileFields(anyU);
    }),
    tap(v => this.dbg('profileEligible$', v)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('profileEligible$', false))
  );

  // ---------------------------------------------------------------------------
  // Estado consolidado (máquina de estados “base”)
  // ---------------------------------------------------------------------------

  readonly state$: Observable<AccessState> = combineLatest([
    this.isAuthenticated$,
    this.profileCompleted$,
    this.emailVerified$,
  ]).pipe(
    map(([isAuth, profileOk, emailOk]) => {
      if (!isAuth) return 'GUEST';
      if (!profileOk) return 'AUTHED_PROFILE_INCOMPLETE';
      if (!emailOk) return 'AUTHED_PROFILE_COMPLETE_UNVERIFIED';
      return 'AUTHED_PROFILE_COMPLETE_VERIFIED';
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('state$', 'GUEST' as AccessState))
  );

  // ---------------------------------------------------------------------------
  // Gates canônicos (padrão “plataforma grande”)
  // ---------------------------------------------------------------------------

  /**
   * Gate base de execução do app (decisões UI/guards/listeners):
   * - routerReady evita decisões prematuras
   * - isBlocked derruba gates “por cima”
   */
  readonly canRunApp$ = combineLatest([this.routerReady$, this.isBlocked$]).pipe(
    map(([routerReady, blocked]) => routerReady === true && blocked === false),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunApp$', false))
  );

  /**
   * Gate infra realtime (nível 1.5):
   * - watchers “infra” (ex.: keepAlive baixo custo, caches, etc.)
   * - não depende de profileCompleted
   * - bloqueia em rotas sensíveis (registro/login) pra evitar custo/ruído
   */
  readonly canRunInfraRealtime$ = combineLatest([
    this.canRunApp$,
    this.ready$,
    this.authUid$,
    this.inRegistrationFlow$,
  ]).pipe(
    map(([canRunApp, ready, uid, inReg]) => canRunApp && ready && !!uid && inReg === false),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunInfraRealtime$', false))
  );

  readonly canRunChatRealtime$ = combineLatest([
    this.canRunInfraRealtime$,
    this.emailVerified$,
  ]).pipe(
    map(([infraOk, emailOk]) => infraOk && emailOk),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunChatRealtime$', false))
  );

  /**
   * Gate PRESENÇA (infra) — OPÇÃO A
   * - Presence NÃO roda em rotas sensíveis (/register e /login)
   * - Não exige emailVerified/profileEligible
   *
   * Implementação:
   * - Alias do gate infra (fonte única)
   */
  readonly canRunPresence$ = this.canRunInfraRealtime$;

  /**
   * Gate produto realtime (nível 2):
   * - features que expõem/consomem dados sensíveis: discovery/online-users/etc.
   * - exige email verificado + perfil elegível + fora do fluxo sensível
   */
  readonly canRunProductRealtime$ = combineLatest([
    this.canRunInfraRealtime$,
    this.emailVerified$,
    this.profileEligible$,
  ]).pipe(
    map(([infraOk, emailOk, profileEligible]) => infraOk === true && emailOk === true && profileEligible === true),
    tap(v => this.dbg('canRunProductRealtime$', v)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunProductRealtime$', false))
  );

  /**
   * Gate específico OnlineUsers (produto / discovery):
   * - Usa gate de produto (nível 2)
   * - Anti mismatch: appUser.uid precisa bater com authUid
   *   (evita “restore” estranho enquanto o appUser ainda não hidratou corretamente)
   */
  readonly canRunOnlineUsers$: Observable<boolean> = combineLatest([
    this.canRunProductRealtime$,
    this.canRunInfraRealtime$,
    this.emailVerified$,
    this.profileEligible$,
    this.authUid$,
    this.appUser$,
    this.currentUrl$,
    this.inRegistrationFlow$,
  ]).pipe(
    map(([canRunProduct, infraOk, emailOk, profileEligible, uid, appUser, url, inReg]) => {
      if (!canRunProduct) return false;
      if (!uid) return false;
      if (appUser === undefined || appUser === null) return false;

      const appUid = (appUser as any)?.uid;
      if (typeof appUid === 'string' && appUid && appUid !== uid) return false;

      return true;
    }),
    tap((can) => {
      // loga o “porquê” a cada mudança (ou no primeiro replay)
      // (pega o último snapshot dos streams acima)
      this.dbg('canRunOnlineUsers$', {
        can,
        url: this.router.url,
        // não dá pra “reler” aqui sem re-combinar, então deixo o essencial:
        note: 'Se can=false, veja os logs de canRunProductRealtime/profileEligible/appUser no console.',
      });
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunOnlineUsers$', false))
  );

  // ---------------------------------------------------------------------------
  // Capacidades de alto nível (Guards e UI) — compatibilidade
  // ---------------------------------------------------------------------------

  /** Pode entrar no “core” do app (dashboard/chat/etc.)? */
  readonly canEnterCore$: Observable<boolean> = combineLatest([this.state$, this.isBlocked$]).pipe(
    map(([s, blocked]) => s === 'AUTHED_PROFILE_COMPLETE_VERIFIED' && !blocked),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canEnterCore$', false))
  );

  /**
   * Compat: “pode ligar listeners realtime?”
   * Versão segura: aponta para o gate de produto (nível 2).
   */
  readonly canListenRealtime$: Observable<boolean> = this.canRunProductRealtime$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canListenRealtime$', false))
  );

  /** Pode acessar etapas pós-auth (register/welcome/finalizar) sem estar bloqueado? */
  readonly canEnterRegistrationSteps$: Observable<boolean> = combineLatest([this.isAuthenticated$, this.isBlocked$]).pipe(
    map(([isAuth, blocked]) => !!isAuth && !blocked),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canEnterRegistrationSteps$', false))
  );

  // ---------------------------------------------------------------------------
  // Role gating (mantendo compatibilidade)
  // ---------------------------------------------------------------------------

  /**
   * Role do app:
   * - espera a resolução inicial (ignora 'undefined')
   * - emite 'visitante' se null
   */
  private readonly role$: Observable<UserRole> = this.appUser$.pipe(
    filter(u => u !== undefined),
    map(u => this.safeRole((u as any)?.role ?? 'visitante')),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('role$', 'visitante' as UserRole))
  );

  hasAtLeast$(min: UserRole): Observable<boolean> {
    return this.role$.pipe(
      map(r => this.safeRank(r) >= this.safeRank(min)),
      distinctUntilChanged(),
      catchError(this.handleStreamError(`hasAtLeast$(${String(min)})`, false))
    );
  }

  hasAny$(allowed: UserRole[]): Observable<boolean> {
    const allowedSet = new Set((allowed ?? []).map(a => String(a)));
    return this.role$.pipe(
      map(r => allowedSet.has(String(r))),
      distinctUntilChanged(),
      catchError(this.handleStreamError('hasAny$', false))
    );
  }

  // ---------------------------------------------------------------------------
  // Conveniências úteis (opcionais)
  // ---------------------------------------------------------------------------

  /** Visitante ou plano free */
  readonly isFree$: Observable<boolean> = combineLatest([this.isAuthenticated$, this.role$]).pipe(
    map(([isAuth, role]) => !isAuth || role === 'free' || role === 'visitante'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isFree$', true))
  );

  /** Assinante (ajuste conforme sua política real) */
  readonly isSubscriber$: Observable<boolean> = this.role$.pipe(
    map(role => ['premium', 'vip'].includes(String(role))),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isSubscriber$', false))
  );
} // linha 533, final do AccessControlService
// Não esquecer comentários explicativos sobre o propósito do serviço, de seus métodos e avisos de uso.
