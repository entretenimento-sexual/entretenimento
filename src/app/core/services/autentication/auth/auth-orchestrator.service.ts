// src/app/core/services/autentication/auth/auth-orchestrator.service.ts
// =============================================================================
// AUTH ORCHESTRATOR (Efeitos colaterais e ciclo de vida)
//
// Objetivo principal deste service:
// - Orquestrar o que roda quando a sessão existe (watchers, bloqueio,
//   navegação defensiva e side-effects pós-login).
// - Garantir que listeners de infraestrutura não iniciem no registro e não
//   iniciem para emailVerified=false.
// - Centralizar encerramento de sessão apenas quando inevitável.
//
// Fonte única:
// - AuthSessionService = sessão Firebase/Auth
// - CurrentUserStoreService = perfil runtime do app
// - AuthAppBlockService = bloqueio do app
// - AuthRouteContextService = contexto canônico de rota/auth-flow
// - AuthUserDocumentWatchService = observação do users/{uid}
// - AuthSessionMonitorService = monitor técnico da sessão
// - AuthPostLoginEffectsService = efeitos pós-login
// - AuthOrchestratorService = coordenação de side-effects
//
// Observação arquitetural:
// - O listener do perfil users/{uid} NÃO é responsabilidade deste service.
//   Ele permanece no fluxo oficial AuthSessionSyncEffects + UserEffects.
// - Aqui ficam apenas side-effects de ciclo de vida.
// - O contexto de rota entra como snapshot atômico via routeContext.context$.
// =============================================================================

import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { combineLatest, firstValueFrom, of, Subscription } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import type { User } from 'firebase/auth';

import { AuthSessionService } from './auth-session.service';
import { AuthRouteContextService } from './auth-route-context.service';
import {
  AuthUserDocumentWatchService,
  type AuthUserDocumentWatchEvent,
} from './auth-user-document-watch.service';
import { AuthSessionMonitorService } from './auth-session-monitor.service';
import { AuthPostLoginEffectsService } from './auth-post-login-effects.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { AuthAppBlockService } from './auth-app-block.service';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { environment } from 'src/environments/environment';
import { LogoutService } from './logout.service';

import { inRegistrationFlow as isRegFlow, type TerminateReason } from './auth.types';
import { UserRepositoryService } from '../../data-handling/firestore/repositories/user-repository.service';

type OrchestratorContext = {
  ready: boolean;
  routerReady: boolean;
  authUser: User | null;
  uid: string | null;
  url: string;
  navPath: string | null;
  inReg: boolean;
  unverified: boolean;
  blockedReason: TerminateReason | null;
};

@Injectable({ providedIn: 'root' })
export class AuthOrchestratorService {
  private userDocWatchSub: Subscription | null = null;
  private postLoginSub: Subscription | null = null;

  private watchersUid: string | null = null;
  private watchersOn = false;

  private sessionUid: string | null = null;
  private postLoginUid: string | null = null;

  private terminating = false;
  private freshUntil = 0;
  private sawUserDocOnce = false;
  private started = false;

  private missingDocProbeId: ReturnType<typeof setTimeout> | null = null;
  private readonly debug = !environment.production;

  /**
   * true:
   * - bloqueia o app e mantém a sessão autenticada quando o problema é de domínio
   *
   * false:
   * - força hard signOut também nesses cenários
   */
  private readonly voluntaryLogoutOnly =
    (environment as any)?.features?.logoutOnlyVoluntary !== false;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly routeContext: AuthRouteContextService,
    private readonly userDocumentWatch: AuthUserDocumentWatchService,
    private readonly sessionMonitor: AuthSessionMonitorService,
    private readonly postLoginEffects: AuthPostLoginEffectsService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly userRepo: UserRepositoryService,
    private readonly router: Router,
    private readonly logoutService: LogoutService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly appBlock: AuthAppBlockService,
  ) {}

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthOrchestrator] ${message}`, extra ?? '');
  }

  /**
   * Liga o orquestrador uma única vez.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    combineLatest([
      this.authSession.ready$,
      this.authSession.authUser$,
      this.appBlock.reason$,
      this.routeContext.context$,
    ])
      .pipe(
        filter(() => typeof window !== 'undefined' && typeof document !== 'undefined'),

        map(([ready, authUser, blockedReason, routeCtx]): OrchestratorContext => {
          const uid = authUser?.uid ?? null;

          return {
            ready,
            routerReady: routeCtx.routerReady,
            authUser,
            uid,
            url: routeCtx.currentUrl,
            navPath: routeCtx.navPath,
            inReg: routeCtx.inRegistrationFlow,
            unverified: authUser ? authUser.emailVerified !== true : false,
            blockedReason,
          };
        }),

        distinctUntilChanged((prev, curr) => this.isSameContext(prev, curr)),

        tap((ctx) => {
          this.dbg('context', {
            ready: ctx.ready,
            routerReady: ctx.routerReady,
            uid: ctx.uid,
            url: ctx.url,
            navPath: ctx.navPath,
            inReg: ctx.inReg,
            unverified: ctx.unverified,
            blockedReason: ctx.blockedReason,
          });
        }),

        switchMap((ctx) => {
          if (this.terminating) return of(null);
          if (!ctx.ready) return of(null);
          if (!ctx.routerReady) return of(null);

          if (!ctx.authUser || !ctx.uid) {
            this.handleNoAuthUser();
            return of(null);
          }

          if (this.sessionUid !== ctx.uid) {
            this.handleUidChange(ctx.uid);
          }

          this.refreshGraceWindow(ctx.authUser);

          if (ctx.blockedReason) {
            this.stopRuntimeSideEffects();

            if (!ctx.inReg) {
              this.navigateToWelcome(ctx.blockedReason, true);
            }

            return of(null);
          }

          const shouldRunAppMode = !ctx.inReg && !ctx.unverified;

          this.sessionMonitor.start();
          this.syncWatchers(ctx.uid, shouldRunAppMode);
          this.syncPostLoginEffects(ctx.authUser, shouldRunAppMode);

          return of(null);
        }),

        catchError((err) => {
          this.reportSilent(err, { phase: 'start.pipeline' });
          return of(null);
        })
      )
      .subscribe();
  }

  private isSameContext(prev: OrchestratorContext, curr: OrchestratorContext): boolean {
    if (prev.ready !== curr.ready) return false;
    if (prev.routerReady !== curr.routerReady) return false;

    if (!curr.ready) return true;
    if (!curr.routerReady) return true;

    if (prev.uid !== curr.uid) return false;
    if (prev.blockedReason !== curr.blockedReason) return false;

    if (!curr.uid) return true;

    return (
      prev.url === curr.url &&
      prev.navPath === curr.navPath &&
      prev.inReg === curr.inReg &&
      prev.unverified === curr.unverified
    );
  }

  private handleNoAuthUser(): void {
    this.sessionUid = null;
    this.currentUserStore.clear();
    this.appBlock.clear();
    this.stopRuntimeSideEffects();
    this.resetTransientSessionState();

    this.dbg('handleNoAuthUser()');
  }

  private handleUidChange(uid: string): void {
    this.sessionUid = uid;
    this.appBlock.clear();
    this.currentUserStore.markUnhydrated();
    this.stopPostLoginEffects();
    this.stopWatchers();
    this.resetTransientSessionState();

    this.dbg('handleUidChange()', { uid });
  }

  private resetTransientSessionState(): void {
    this.sawUserDocOnce = false;
    this.freshUntil = 0;
    this.clearMissingDocProbe();
  }

  private stopRuntimeSideEffects(): void {
    this.sessionMonitor.stop();
    this.stopWatchers();
    this.stopPostLoginEffects();
  }

  private refreshGraceWindow(authUser: User): void {
    const now = Date.now();
    const createdAt = authUser.metadata?.creationTime
      ? new Date(authUser.metadata.creationTime).getTime()
      : now;

    const graceNewUser = createdAt + 30_000;
    const graceAnyLogin = now + 6_000;

    this.freshUntil = Math.max(this.freshUntil, graceNewUser, graceAnyLogin);
  }

  private clearMissingDocProbe(): void {
    if (!this.missingDocProbeId) return;
    clearTimeout(this.missingDocProbeId);
    this.missingDocProbeId = null;
  }

  private scheduleMissingDocConfirm(
    uid: string,
    reason: Extract<TerminateReason, 'deleted' | 'doc-missing-confirmed'>
  ): void {
    this.clearMissingDocProbe();

    const delay = Math.max(this.freshUntil - Date.now(), 0) + 150;

    this.missingDocProbeId = setTimeout(() => {
      this.missingDocProbeId = null;

      this.confirmAndSignOutIfMissing(uid, reason).catch((err) => {
        this.reportSilent(err, {
          phase: 'missingDocProbe',
          uid,
          reason,
        });
      });
    }, delay);
  }

  private async confirmAndSignOutIfMissing(
    uid: string,
    reason: Extract<TerminateReason, 'deleted' | 'doc-missing-confirmed'>
  ): Promise<void> {
    const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;

    if (!allowAct) {
      this.scheduleMissingDocConfirm(uid, reason);
      return;
    }

    const stillMissing = await firstValueFrom(this.userRepo.confirmUserDocMissing$(uid));
    if (!stillMissing) return;

    if (this.voluntaryLogoutOnly) {
      this.blockAppSession(reason);
      return;
    }

    this.hardSignOutToEntry(reason);
  }

  private stopPostLoginEffects(): void {
    this.postLoginSub?.unsubscribe();
    this.postLoginSub = null;
    this.postLoginUid = null;
  }

  private syncPostLoginEffects(authUser: User, shouldRun: boolean): void {
    if (!shouldRun) {
      if (this.postLoginSub) {
        this.stopPostLoginEffects();
      }
      return;
    }

    if (this.postLoginUid === authUser.uid) return;

    this.stopPostLoginEffects();
    this.postLoginUid = authUser.uid;

    this.postLoginSub = this.postLoginEffects
      .run$(authUser)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.postLoginSub = null;
        },
        error: () => {
          this.postLoginSub = null;
        },
        complete: () => {
          this.postLoginSub = null;
        },
      });
  }

  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    try {
      const error = new Error('[AuthOrchestrator] internal error');
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).original = err;
      (error as any).context = context;
      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
    }
  }

  private notifyAppBlocked(reason: TerminateReason): void {
    const url = this.router.url || '';
    if (this.isRegistrationFlowUrl(url)) return;

    this.errorNotifier.showError(
      'Sua conta precisa de atenção. Finalize as etapas para continuar.'
    );

    this.reportSilent(new Error('App session blocked'), { reason });
  }

  private navigateToWelcome(reason: TerminateReason, replaceUrl = true): void {
    const target = '/register/welcome';

    if ((this.router.url || '').startsWith(target)) return;

    this.router
      .navigate([target], {
        queryParams: { reason, autocheck: '1' },
        replaceUrl,
      })
      .catch(() => {});
  }

  private isRegistrationFlowUrl(url: string): boolean {
    return isRegFlow(url);
  }

  private stopWatchers(): void {
    this.userDocWatchSub?.unsubscribe();
    this.userDocWatchSub = null;
    this.watchersOn = false;
    this.watchersUid = null;
  }

  private syncWatchers(uid: string, shouldRun: boolean): void {
    if (!shouldRun) {
      if (this.watchersOn) this.stopWatchers();
      return;
    }

    if (this.watchersOn && this.watchersUid === uid) return;

    this.stopWatchers();
    this.startUserDocumentWatch(uid);

    this.watchersOn = true;
    this.watchersUid = uid;

    this.dbg('syncWatchers()', { uid, shouldRun });
  }

  private startUserDocumentWatch(uid: string): void {
    this.userDocWatchSub = this.userDocumentWatch.watch$(uid).subscribe({
      next: (event) => this.handleUserDocumentWatchEvent(event),
      error: (err) => {
        this.reportSilent(err, {
          phase: 'userDocumentWatch.subscribe',
          uid,
        });
      },
    });
  }

  private handleUserDocumentWatchEvent(event: AuthUserDocumentWatchEvent): void {
    switch (event.type) {
      case 'exists': {
        this.clearMissingDocProbe();
        this.sawUserDocOnce = true;
        return;
      }

      case 'missing': {
        this.confirmAndSignOutIfMissing(event.uid, 'doc-missing-confirmed').catch((err) => {
          this.reportSilent(err, {
            phase: 'userDocumentWatch.missing',
            uid: event.uid,
          });
        });
        return;
      }

      case 'suspended': {
        if (this.voluntaryLogoutOnly) {
          this.blockAppSession('suspended');
          return;
        }

        this.hardSignOutToEntry('suspended');
        return;
      }

      case 'deleted': {
        if (event.source === 'deleted-flag') {
          this.confirmAndSignOutIfMissing(event.uid, 'deleted').catch((err) => {
            this.reportSilent(err, {
              phase: 'userDocumentWatch.deletedFlag',
              uid: event.uid,
            });
          });
          return;
        }

        if (this.voluntaryLogoutOnly) {
          this.blockAppSession('deleted');
          return;
        }

        this.hardSignOutToEntry('deleted');
        return;
      }

      case 'forbidden': {
        this.reportSilent(event.error, {
          phase: 'userDocumentWatch.forbidden',
          uid: event.uid,
          source: event.source,
          code: event.code,
        });

        const url = this.router.url || '';
        if (this.isRegistrationFlowUrl(url)) return;

        const allowAct = this.sawUserDocOnce || Date.now() > this.freshUntil;
        if (!allowAct) return;

        if (this.voluntaryLogoutOnly) {
          this.blockAppSession('forbidden');
          return;
        }

        this.hardSignOutToEntry('forbidden');
        return;
      }

      case 'error': {
        this.reportSilent(event.error, {
          phase: 'userDocumentWatch.error',
          uid: event.uid,
          source: event.source,
          code: event.code,
        });
        return;
      }
    }
  }

  private hardSignOutToEntry(reason: TerminateReason): void {
    if (this.terminating) return;
    this.terminating = true;

    try {
      this.stopRuntimeSideEffects();
      this.clearMissingDocProbe();

      this.logoutService.hardSignOutToWelcome(reason);
      this.appBlock.clear();
    } finally {
      this.terminating = false;
    }
  }

  private blockAppSession(reason: TerminateReason): void {
    if (this.terminating) return;
    this.terminating = true;

    try {
      this.appBlock.set(reason);
      this.currentUserStore.setUnavailable();
      this.stopRuntimeSideEffects();
      this.clearMissingDocProbe();

      this.notifyAppBlocked(reason);
      this.navigateToWelcome(reason, true);
    } finally {
      this.terminating = false;
    }
  }
} // fim do auth-orchestrator.service.ts, linha 557
