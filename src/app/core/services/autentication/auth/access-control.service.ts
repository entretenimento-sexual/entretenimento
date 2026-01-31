// src/app/core/services/autentication/auth/access-control.service.ts
// Serviço central de controle de acesso/capacidades (estilo “grandes plataformas”).
//
// Objetivo:
// - Derivar um estado único de acesso a partir de:
//   (1) AuthSessionService (verdade do Firebase Auth: uid, emailVerified, ready$)
//   (2) CurrentUserStoreService (verdade do app: role, profileCompleted, etc.)
//   (3) AuthAppBlockService (verdade do bloqueio do app: TerminateReason | null)
// - Expor Observables simples para Guards e UI gating (menu, listeners realtime, writes).
// - Manter métodos existentes (hasAtLeast$, hasAny$) para não quebrar o projeto.
// - Erros: sempre roteados para GlobalErrorHandlerService e ErrorNotificationService,
//   com degradação segura (nunca liberar acesso em caso de erro).

import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, shareReplay, startWith } from 'rxjs/operators';

import type { IUserDados } from '../../../interfaces/iuser-dados';
import type { TerminateReason } from './auth.types';

import { AuthSessionService } from './auth-session.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { AuthAppBlockService } from './auth-app-block.service';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';

export type UserRole = IUserDados['role'];

/**
 * Estado consolidado de acesso (mínimo e suficiente para guiar UX + Guards):
 * - GUEST: sem sessão
 * - AUTHED_PROFILE_INCOMPLETE: autenticado, mas perfil não finalizado no app
 * - AUTHED_PROFILE_COMPLETE_UNVERIFIED: perfil ok, mas e-mail ainda não verificado
 * - AUTHED_PROFILE_COMPLETE_VERIFIED: perfil ok + e-mail verificado (base para liberar core)
 *
 * Observação:
 * - O bloqueio do app (AuthAppBlockService) atua “por cima” desse estado.
 */
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
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly appBlock = inject(AuthAppBlockService);

  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notify = inject(ErrorNotificationService);

  // Evita spam de notificação por falhas em streams (singleton)
  private _lastNotifyAt = 0;

  // ---------------------------------------------
  // Helpers (segurança e compatibilidade)
  // ---------------------------------------------

  private safeRank(role: unknown): number {
    const key = (role ?? 'visitante') as string;
    return ROLE_RANK[key] ?? ROLE_RANK['visitante'];
  }

  private safeRole(role: unknown): UserRole {
    const key = (role ?? 'visitante') as string;
    return (ROLE_RANK[key] != null ? key : 'visitante') as UserRole;
  }

  /**
   * Roteia erro para o handler global com tipo seguro (evita TS2345 de unknown).
   * E dispara uma notificação genérica com throttle.
   */
  private handleStreamError<T>(context: string, fallback: T): (err: unknown) => Observable<T> {
    return (err: unknown) => {
      // Normaliza unknown -> Error (para compat com o GlobalErrorHandlerService)
      const e = err instanceof Error ? err : new Error(`AccessControlService stream error: ${context}`);
      (e as any).silent = true;       // reduz ruído de UX (stream interno)
      (e as any).original = err;
      (e as any).context = context;

      this.globalError.handleError(e);

      // Feedback controlado (não spamma)
      const now = Date.now();
      if (now - this._lastNotifyAt > 15_000) {
        this._lastNotifyAt = now;
        this.notify.showError('Falha ao validar acesso. Tente novamente.');
      }

      // Degrada com segurança (fallback restritivo)
      return of(fallback);
    };
  }

  // ---------------------------------------------
  // Streams base (Auth + AppUser + Block)
  // ---------------------------------------------

  /** Sessão pronta? (Auth restaurado) — evita decisões prematuras em guards/UI */
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

  /** Motivo do bloqueio do app (fonte única: AuthAppBlockService) */
  readonly blockedReason$: Observable<TerminateReason | null> = this.appBlock.reason$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('blockedReason$', null))
  );

  /** True quando o app está bloqueado (sem logout) */
  readonly isBlocked$: Observable<boolean> = this.blockedReason$.pipe(
    map(r => !!r),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isBlocked$', false))
  );

  // ---------------------------------------------
  // Derivações de sessão e verificação
  // ---------------------------------------------

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
      if (u === undefined) return false; // carregando => seguro (nega)
      return (u as any)?.profileCompleted === true;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('profileCompleted$', false))
  );

  // ---------------------------------------------
  // Estado consolidado (máquina de estados “base”)
  // ---------------------------------------------

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

  // ---------------------------------------------
  // Capacidades de alto nível (Guards e UI)
  // ---------------------------------------------

  /**
   * Pode entrar no “core” do app (dashboard/chat/invites/etc.)?
   * Regra:
   * - precisa estar VERIFIED no estado base
   * - e NÃO pode estar bloqueado pelo Orchestrator (AuthAppBlockService)
   */
  readonly canEnterCore$: Observable<boolean> = combineLatest([this.state$, this.isBlocked$]).pipe(
    map(([s, blocked]) => s === 'AUTHED_PROFILE_COMPLETE_VERIFIED' && !blocked),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canEnterCore$', false))
  );

  /**
   * Pode ligar listeners realtime (onSnapshot/collectionData) sem risco?
   * Recomendação: use exatamente o mesmo gating do core.
   */
  readonly canListenRealtime$: Observable<boolean> = this.canEnterCore$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canListenRealtime$', false))
  );

  /**
   * Pode acessar telas do fluxo pós-auth (/register/welcome, /finalizar-cadastro, etc.)?
   * - Acesso permitido para autenticados, mas bloqueio do app impede “seguir adiante”
   *   sem passar pelo fluxo de correção (navegação do Orchestrator).
   */
  readonly canEnterRegistrationSteps$: Observable<boolean> = combineLatest([this.isAuthenticated$, this.isBlocked$]).pipe(
    map(([isAuth, blocked]) => !!isAuth && !blocked),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canEnterRegistrationSteps$', false))
  );

  // ---------------------------------------------
  // Role gating (mantendo compatibilidade)
  // ---------------------------------------------

  /**
   * Role do app:
   * - espera a resolução inicial (ignora 'undefined')
   * - emite 'visitante' se null
   * Mantém a mesma semântica do seu serviço atual (para não quebrar o projeto).
   */
  private readonly role$: Observable<UserRole> = this.appUser$.pipe(
    filter(u => u !== undefined),
    map(u => this.safeRole((u as any)?.role ?? 'visitante')),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('role$', 'visitante' as UserRole))
  );

  /** Mantido: “tem no mínimo tal role?” */
  hasAtLeast$(min: UserRole): Observable<boolean> {
    return this.role$.pipe(
      map(r => this.safeRank(r) >= this.safeRank(min)),
      distinctUntilChanged(),
      catchError(this.handleStreamError(`hasAtLeast$(${String(min)})`, false))
    );
  }

  /** Mantido: “tem qualquer uma dessas roles?” */
  hasAny$(allowed: UserRole[]): Observable<boolean> {
    const allowedSet = new Set((allowed ?? []).map(a => String(a)));
    return this.role$.pipe(
      map(r => allowedSet.has(String(r))),
      distinctUntilChanged(),
      catchError(this.handleStreamError('hasAny$', false))
    );
  }

  // ---------------------------------------------
  // Conveniências úteis (opcionais)
  // ---------------------------------------------

  /** Visitante ou plano free (útil para banners/upsell) */
  readonly isFree$: Observable<boolean> = combineLatest([this.isAuthenticated$, this.role$]).pipe(
    map(([isAuth, role]) => !isAuth || role === 'free' || role === 'visitante'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isFree$', true))
  );

  /** Assinante (exemplo simples; ajuste conforme sua política real) */
  readonly isSubscriber$: Observable<boolean> = this.role$.pipe(
    map(role => ['premium', 'vip'].includes(String(role))),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isSubscriber$', false))
  );
}

/*
  Fonte única (sem duplicação de “verdade”):

  - AuthSessionService = verdade do Firebase Auth (authUser$, uid$, ready$)
  - CurrentUserStoreService = verdade do usuário do app (IUserDados / role / profileCompleted)
  - AuthAppBlockService = verdade do “bloqueio do app” (TerminateReason | null)
  - AuthOrchestratorService = efeitos colaterais (presence, watchers, keepAlive, navegação defensiva)
  - AccessControlService = políticas/capacidades (canEnterCore$, canListenRealtime$, gating por role)
*/
