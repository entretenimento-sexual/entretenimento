// src/app/core/services/autentication/auth/logout.service.ts
// =============================================================================
// LOGOUT SERVICE (Auth-only)
//
// Objetivo:
// - Centralizar logout voluntário e hard signout inevitável.
// - Coordenar side-effects que pertencem ao encerramento da sessão:
//   presença, geolocalização, Web Push, signOut, limpeza de perfil runtime e navegação.
// - Tornar o encerramento imediatamente visível para toda a plataforma sem
//   falsificar o estado técnico do Firebase antes de signOut concluir.
// =============================================================================
import {
  EnvironmentInjector,
  Injectable,
  runInInjectionContext,
} from '@angular/core';
import { ChildrenOutletContexts, NavigationEnd, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Auth, signOut } from '@angular/fire/auth';

import { BehaviorSubject, EMPTY, Observable, combineLatest, defer, forkJoin, from, merge, of, throwError, timer } from 'rxjs';
import {
  catchError,
  defaultIfEmpty,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';

import { PresenceService } from '@core/services/presence/presence.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthSessionService } from './auth-session.service';
import { AuthSessionExitService } from './auth-session-exit.service';
import { confirmLogoutWithDraft$ } from '@core/guards/unsaved-changes/logout-draft-confirmation';
import { CacheService } from '@core/services/general/cache/cache.service';
import { GeolocationTrackingService } from '@core/services/geolocation/geolocation-tracking.service';
import {
  PushNotificationDeviceService,
  type PushNotificationDeviceState,
} from '@core/services/notifications/push-notification-device.service';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { inRegistrationFlow as isRegFlow, type TerminateReason } from './auth.types';
import { clearPendingLogout, readPendingLogout, savePendingLogout } from '@core/firebase/pending-logout';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

type SignOutMode = 'strict' | 'best-effort';
type LogoutFeedback = {
  phase: 'ending' | 'delayed' | 'unconfirmed' | 'failed';
  user: NonNullable<Auth['currentUser']>;
};

const BEST_EFFORT_CLEANUP_TIMEOUT_MS = 3_000;
const LOGOUT_FEEDBACK_TIMEOUT_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class LogoutService {
  /**
   * Uma única operação de encerramento pode existir por vez.
   * Chamadores concorrentes compartilham o mesmo Observable e observam o mesmo
   * sucesso/erro; ninguém recebe falso sucesso enquanto outro logout ainda roda.
   */
  private terminationInFlight$: Observable<void> | null = null;
  private readonly logoutFeedback = new BehaviorSubject<LogoutFeedback | null>(null);
  readonly voluntaryLogoutStatus$ = combineLatest([
    this.logoutFeedback,
    this.authSession.authUser$.pipe(startWith(null)),
  ]).pipe(
    map(([feedback, user]) => {
      if (feedback?.phase === 'failed' &&
          (feedback.user !== this.auth.currentUser || feedback.user.uid !== user?.uid)) return null;
      return feedback?.phase ?? null;
    }),
    distinctUntilChanged()
  );

  constructor(
    private readonly auth: Auth,
    private readonly router: Router,
    private readonly presence: PresenceService,
    private readonly geolocation: GeolocationTrackingService,
    private readonly pushNotifications: PushNotificationDeviceService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly appBlock: AuthAppBlockService,
    private readonly authSession: AuthSessionService,
    private readonly applicationError: ApplicationErrorService,
    private readonly envInjector: EnvironmentInjector,
    private readonly privacyDebug: PrivacyDebugLoggerService,
    private readonly cache: CacheService,
    private readonly outletContexts: ChildrenOutletContexts,
    private readonly dialog: MatDialog,
    private readonly sessionExit: AuthSessionExitService,
  ) {}

  /**
   * Logout voluntário global.
   *
   * Após a confirmação de rascunho, quando necessária, AuthSessionService entra
   * em `terminating` e deixa de expor a sessão operacional. O Firebase Auth
   * continua disponível para a limpeza autenticada que precede o signOut.
   */
  logout$(): Observable<void> {
    if (this.terminationInFlight$) return this.terminationInFlight$;
    if (this.logoutFeedback.value?.phase === 'unconfirmed') return EMPTY;

    let shared$: Observable<void>;

    let started = false;
    shared$ = defer(() => {
      started = false;
      const user = this.auth.currentUser;
      if (!user) return EMPTY;
      const route = this.router.routerState.snapshot.root;

      const cancelled$ = merge(
        this.authSession.authUser$.pipe(filter(() => this.auth.currentUser !== user)),
        this.router.events.pipe(filter((event) => event instanceof NavigationEnd))
      );
      return defer(() => confirmLogoutWithDraft$(this.outletContexts, this.dialog, cancelled$)).pipe(
        switchMap((discard) => {
          if (!discard || this.auth.currentUser !== user || this.router.routerState.snapshot.root !== route) {
            return EMPTY;
          }

          const pushState = this.pushNotifications.currentStateSnapshot;
          started = true;
          this.logoutFeedback.next({ phase: 'ending', user });
          this.authSession.beginTermination();
          try {
            savePendingLogout(user.uid);
          } catch (error: unknown) {
            this.reportSilent(error, { phase: 'persistVoluntaryLogout' });
          }
          const warning = timer(LOGOUT_FEEDBACK_TIMEOUT_MS).subscribe(() => {
            this.logoutFeedback.next({ phase: 'delayed', user });
            this.reportSilent(new Error('A confirmação de saída ainda está pendente.'), {
              phase: 'waitForVoluntarySignOut',
              timeoutMs: LOGOUT_FEEDBACK_TIMEOUT_MS,
            });
          });

          return this.stopGeolocationBestEffort$().pipe(
            switchMap(() => this.auth.currentUser === user
              ? forkJoin([this.stopPresenceBestEffort$(), this.deactivatePushBestEffort$()])
              : EMPTY),
            switchMap(() => this.auth.currentUser === user ? this.executeSignOut$('strict') : EMPTY),
            tap({ next: () => warning.unsubscribe(), error: () => warning.unsubscribe() }),
            switchMap(() => this.auth.currentUser === user
              ? throwError(() => new Error('Firebase não confirmou o encerramento da sessão.'))
              : of(void 0)),
            catchError((error: unknown) => this.handleVoluntarySignOutFailure$(error, pushState, user)),
            switchMap(() => {
              clearPendingLogout(user.uid);
              // Uma conta que entrou durante a operação segue no contexto dela.
              if (this.auth.currentUser) return EMPTY;
              this.sessionExit.markSignedOut();
              try {
                discard();
              } catch (error: unknown) {
                this.reportSilent(error, { phase: 'discardLogoutDraft' });
              }
              return this.clearLocalSessionDataBestEffort$(true);
            }),
            switchMap(() => this.auth.currentUser ? EMPTY : this.sessionExit.openAfterLogout$()),
            finalize(() => warning.unsubscribe())
          );
        }),
        catchError((error: unknown) => {
          if (!started && this.auth.currentUser === user) {
            this.logoutFeedback.next({ phase: 'failed', user });
            this.reportSilent(error, { phase: 'prepareVoluntaryLogout' });
          }
          return throwError(() => error);
        })
      );
    }).pipe(
      finalize(() => {
        if (this.terminationInFlight$ === shared$) this.terminationInFlight$ = null;
        const phase = this.logoutFeedback.value?.phase;
        if (!started || phase === 'unconfirmed') return;
        const outgoing = this.logoutFeedback.value?.user;
        if (outgoing && this.auth.currentUser && this.auth.currentUser !== outgoing) clearPendingLogout(outgoing.uid);
        if (this.authSession.isTerminatingSnapshot) this.authSession.endTermination();
        if (phase !== 'failed') this.logoutFeedback.next(null);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.terminationInFlight$ = shared$;
    return shared$;
  }

  logout(): void {
    this.logout$().pipe(take(1)).subscribe({
      next: () => {},
      error: () => {},
    });
  }

  canReloadPendingLogout(): boolean {
    const feedback = this.logoutFeedback.value;
    return feedback !== null && readPendingLogout() === feedback.user.uid;
  }

  retryVoluntaryLogout(): void {
    const feedback = this.logoutFeedback.value;
    if (feedback?.phase === 'failed' && this.auth.currentUser === feedback.user) this.logout();
  }

  /** Retoma somente a saída já solicitada para a conta restaurada. */
  invalidateRestoredSessionForBootstrap$(): Observable<void> {
    return defer(() => {
      const user = this.auth.currentUser;
      if (!user) return of(void 0);

      this.authSession.beginTermination();
      this.logoutFeedback.next({ phase: 'delayed', user });
      return this.deactivatePushBestEffort$().pipe(
        switchMap(() => this.auth.currentUser === user ? this.executeSignOut$('strict') : of(void 0)),
        switchMap(() => {
          if (this.auth.currentUser === user) {
            throw new Error('Firebase não confirmou a saída restaurada.');
          }
          clearPendingLogout(user.uid);
          return this.auth.currentUser ? of(void 0) : this.clearLocalSessionDataBestEffort$(true);
        }),
        tap(() => {
          this.authSession.endTermination();
          this.logoutFeedback.next(null);
        }),
        catchError((error: unknown) => {
          if (this.auth.currentUser && this.auth.currentUser !== user) {
            clearPendingLogout(user.uid);
            this.authSession.endTermination();
            this.logoutFeedback.next(null);
            return of(void 0);
          }
          this.logoutFeedback.next({ phase: 'unconfirmed', user });
          this.reportSilent(error, { phase: 'invalidateRestoredSessionForBootstrap$' });
          return of(void 0);
        })
      );
    });
  }

  /**
   * Hard signout global:
   * - usado quando a sessão do Auth ficou tecnicamente inválida
   * - mascara a sessão operacional imediatamente
   * - tenta parar geolocalização, presença e Web Push
   * - faz signOut best-effort
   * - limpa CurrentUserStore/cache
   * - limpa bloqueio de app
   * - redireciona para welcome com reason
   *
   * Se o Firebase continuar com currentUser após a tentativa best-effort, o
   * estado `terminating` permanece ativo (fail-closed). Assim uma sessão que
   * deveria estar morta não volta a habilitar features apenas porque o signOut
   * técnico falhou naquele instante.
   */
  hardSignOutToWelcome$(
    reason: TerminateReason = 'auth-invalid'
  ): Observable<void> {
    if (this.terminationInFlight$) return this.terminationInFlight$;
    if (this.logoutFeedback.value?.phase === 'unconfirmed') return EMPTY;

    const url = this.router.url || '';

    if (!this.inRegistrationFlow(url)) {
      this.applicationError.report(new Error('Hard sign-out initiated'), {
        feature: 'auth',
        operation: 'hardSignOutToWelcome',
        fallbackMessage:
          'Sua sessão foi encerrada. Faça login novamente.',
        presentation: { surface: 'snackbar', severity: 'error' },
        metadata: {
          scope: 'LogoutService',
          reason,
          expectedTermination: true,
        },
      });
    }

    let shared$: Observable<void>;
    let user: Auth['currentUser'];

    shared$ = defer(() => {
      user = this.auth.currentUser;
      this.authSession.beginTermination();
      return this.stopGeolocationBestEffort$();
    }).pipe(
      switchMap(() => forkJoin([this.stopPresenceBestEffort$(), this.deactivatePushBestEffort$()])),
      switchMap(() => this.auth.currentUser === user ? this.executeSignOut$('best-effort') : of(void 0)),
      switchMap(() => !this.auth.currentUser || this.auth.currentUser === user
        ? this.clearLocalSessionDataBestEffort$()
        : EMPTY),
      switchMap(() => !this.auth.currentUser || this.auth.currentUser === user
        ? this.navigateToWelcomeBestEffort$(reason)
        : EMPTY),
      catchError((err) => {
        this.reportSilent(err, { phase: 'hardSignOutToWelcome$', reason });
        return of(void 0);
      }),
      finalize(() => {
        if (this.terminationInFlight$ === shared$) {
          this.terminationInFlight$ = null;
        }

        if (!this.auth.currentUser || this.auth.currentUser !== user) {
          this.authSession.endTermination();
        } else {
          this.dbg('hard signout permaneceu fail-closed', {
            reason,
            hasFirebaseUser: true,
          });
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.terminationInFlight$ = shared$;
    return shared$;
  }

  hardSignOutToWelcome(reason: TerminateReason = 'auth-invalid'): void {
    this.hardSignOutToWelcome$(reason).pipe(take(1)).subscribe({
      next: () => {},
      error: () => {},
    });
  }

  private inRegistrationFlow(url: string): boolean {
    return isRegFlow(url);
  }

  /**
   * Falha de signOut voluntário não pode deixar a conta autenticada com Presence,
   * geolocalização/Store já desmontados. Primeiro reexpomos a sessão canônica;
   * os orquestradores rearmam seus próprios recursos. Web Push é o único recurso
   * que precisa de restauração explícita porque `deactivate$()` remove o opt-in.
   */
  private handleVoluntarySignOutFailure$(
    err: unknown,
    previousPushState: PushNotificationDeviceState,
    user: LogoutFeedback['user']
  ): Observable<never> {
    const active = this.auth.currentUser;
    if (!active) {
      // O SDK pode limpar o snapshot antes de concluir a escrita na persistência.
      this.logoutFeedback.next({ phase: 'unconfirmed', user });
      this.reportSilent(err, { phase: 'confirmVoluntarySignOut' });
      return throwError(() => err);
    }
    clearPendingLogout(user.uid);
    if (active !== user) return EMPTY;

    this.authSession.endTermination();

    return this.restorePushAfterFailedSignOutBestEffort$(previousPushState).pipe(
      switchMap(() => {
        if (this.auth.currentUser !== user) return EMPTY;
        this.logoutFeedback.next({ phase: 'failed', user });
        this.reportSilent(err, { phase: 'logout', sessionRestored: true });
        return throwError(() => err);
      })
    );
  }

  /**
   * Restaura Web Push sem abrir prompt: só tentamos quando o estado
   * anterior era `active` e o navegador ainda informa permissão `granted`.
   */
  private restorePushAfterFailedSignOutBestEffort$(
    previousState: PushNotificationDeviceState
  ): Observable<void> {
    const canRestoreWithoutPrompt =
      previousState === 'active'
      && typeof Notification !== 'undefined'
      && Notification.permission === 'granted'
      && !!this.auth.currentUser;

    if (!canRestoreWithoutPrompt) return of(void 0);

    return defer(() => this.pushNotifications.activate$('restore')).pipe(
      take(1),
      defaultIfEmpty('inactive' as PushNotificationDeviceState),
      timeout({
        first: BEST_EFFORT_CLEANUP_TIMEOUT_MS,
        with: () => this.cleanupTimeoutFallback$('restorePushAfterFailedSignOutBestEffort$'),
      }),
      map(() => void 0),
      catchError((err) => {
        this.reportSilent(err, {
          phase: 'restorePushAfterFailedSignOutBestEffort$',
        });
        return of(void 0);
      })
    );
  }

  /**
   * Geolocalização pertence à sessão autenticada.
   * Ao encerrar a sessão removemos watcher, listener de permissão e snapshot
   * sensível para impedir reaproveitamento pela próxima conta no mesmo browser.
   */
  private stopGeolocationBestEffort$(): Observable<void> {
    return defer(() => {
      this.geolocation.stopTracking({ clearCachedLocation: true });
      return of(void 0);
    }).pipe(
      catchError((err) => {
        this.reportSilent(err, { phase: 'stopGeolocationBestEffort$' });
        return of(void 0);
      })
    );
  }

  /**
   * Para Presence antes do signOut, mas impõe um limite ao write offline.
   * Uma rede degradada nunca pode manter a sessão Firebase aberta indefinidamente.
   */
  private stopPresenceBestEffort$(): Observable<void> {
    return defer(() => this.presence.stop$()).pipe(
      take(1),
      defaultIfEmpty(void 0),
      timeout({
        first: BEST_EFFORT_CLEANUP_TIMEOUT_MS,
        with: () => this.cleanupTimeoutFallback$('stopPresenceBestEffort$'),
      }),
      catchError((err) => {
        this.reportSilent(err, { phase: 'stopPresenceBestEffort$' });
        return of(void 0);
      })
    );
  }

  /**
   * Remove o vínculo Web Push enquanto a sessão ainda pode autenticar a callable.
   * Qualquer falha é best-effort: push nunca pode impedir logout/hard signout.
   * `defer` também captura falhas síncronas ao iniciar o cleanup e
   * `defaultIfEmpty` impede Observable vazio de encerrar a cadeia prematuramente.
   */
  private deactivatePushBestEffort$(): Observable<void> {
    return defer(() => this.pushNotifications.deactivate$()).pipe(
      take(1),
      defaultIfEmpty(void 0),
      map(() => void 0),
      timeout({
        first: BEST_EFFORT_CLEANUP_TIMEOUT_MS,
        with: () => this.cleanupTimeoutFallback$('deactivatePushBestEffort$'),
      }),
      catchError((err) => {
        this.reportSilent(err, { phase: 'deactivatePushBestEffort$' });
        return of(void 0);
      })
    );
  }

  private executeSignOut$(mode: SignOutMode): Observable<void> {
    return defer(() =>
      from(
        runInInjectionContext(this.envInjector, () => signOut(this.auth))
      )
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        if (mode === 'strict') {
          return throwError(() => err);
        }

        this.reportSilent(err, { phase: 'executeSignOut$', mode });
        return of(void 0);
      })
    );
  }

  private navigateToWelcomeBestEffort$(reason: TerminateReason): Observable<void> {
    return from(
      this.router.navigate(['/register/welcome'], {
        queryParams: { reason, autocheck: '1' },
        replaceUrl: true,
      })
    ).pipe(
      catchError((err) => {
        this.reportSilent(err, {
          phase: 'navigateToWelcomeBestEffort$',
          reason,
        });
        return of(false);
      }),
      map(() => void 0)
    );
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('auth', `LogoutService: ${message}`, extra, 'warn');
  }

  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    const phase =
      typeof context['phase'] === 'string' && context['phase'].trim()
        ? context['phase'].trim()
        : 'internal';

    try {
      this.dbg('reportSilent()', { context, error: err });
      this.applicationError.report(err, {
        feature: 'auth',
        operation: phase,
        fallbackMessage:
          'Não foi possível concluir uma etapa interna do encerramento da sessão.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'LogoutService',
          ...context,
        },
      });
    } catch {
      // O diagnóstico não interfere no estado da sessão.
    }
  }

  private cleanupTimeoutFallback$(phase: string): Observable<void> {
    return defer(() => {
      const error = new Error('[LogoutService] best-effort cleanup timeout');
      this.reportSilent(error, {
        phase,
        timeoutMs: BEST_EFFORT_CLEANUP_TIMEOUT_MS,
      });
      return of(void 0);
    });
  }

  /**
   * Limpeza local pós-logout.
   * Cache sensível não deve sobreviver à sessão; falha de limpeza não bloqueia
   * navegação/signOut. IndexedDB também é limitado para não prender a UI após
   * o Firebase Auth já ter sido encerrado.
   */
  private clearLocalSessionDataBestEffort$(onlyWhenSignedOut = false): Observable<void> {
    return defer(() => this.cache.clearSensitiveSessionCache$()).pipe(
      take(1),
      defaultIfEmpty(void 0),
      timeout({
        first: BEST_EFFORT_CLEANUP_TIMEOUT_MS,
        with: () => this.cleanupTimeoutFallback$('clearLocalSessionDataBestEffort$'),
      }),
      catchError((err) => {
        this.reportSilent(err, {
          phase: 'clearLocalSessionDataBestEffort$',
        });
        return of(void 0);
      }),
      map(() => {
        if (!onlyWhenSignedOut || !this.auth.currentUser) {
          this.appBlock.clear();
          this.currentUserStore.clear();
        }
        return void 0;
      })
    );
  }
}
