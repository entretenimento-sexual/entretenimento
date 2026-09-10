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
import { Router } from '@angular/router';
import { Auth, signOut } from '@angular/fire/auth';

import { Observable, defer, from, of, throwError } from 'rxjs';
import {
  catchError,
  defaultIfEmpty,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';

import { PresenceService } from '@core/services/presence/presence.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthSessionService } from './auth-session.service';
import { CacheService } from '@core/services/general/cache/cache.service';
import { GeolocationTrackingService } from '@core/services/geolocation/geolocation-tracking.service';
import {
  PushNotificationDeviceService,
  type PushNotificationDeviceState,
} from '@core/services/notifications/push-notification-device.service';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { inRegistrationFlow as isRegFlow, type TerminateReason } from './auth.types';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

type SignOutMode = 'strict' | 'best-effort';

const BEST_EFFORT_CLEANUP_TIMEOUT_MS = 3_000;

@Injectable({ providedIn: 'root' })
export class LogoutService {
  /**
   * Uma única operação de encerramento pode existir por vez.
   * Chamadores concorrentes compartilham o mesmo Observable e observam o mesmo
   * sucesso/erro; ninguém recebe falso sucesso enquanto outro logout ainda roda.
   */
  private terminationInFlight$: Observable<void> | null = null;

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
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly envInjector: EnvironmentInjector,
    private readonly privacyDebug: PrivacyDebugLoggerService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Logout voluntário global.
   *
   * Assim que a operação é assinada, AuthSessionService entra em `terminating` e
   * deixa de expor UID/user operacional para o restante da plataforma. Firebase
   * Auth continua tecnicamente disponível internamente apenas durante os cleanups
   * que precisam de credencial antes do signOut.
   */
  logout$(): Observable<void> {
    if (this.terminationInFlight$) return this.terminationInFlight$;

    let shared$: Observable<void>;

    shared$ = this.capturePushStateBestEffort$().pipe(
      tap(() => this.authSession.beginTermination()),
      switchMap((pushState) =>
        this.stopGeolocationBestEffort$().pipe(
          switchMap(() => this.stopPresenceBestEffort$()),
          switchMap(() => this.deactivatePushBestEffort$()),
          switchMap(() =>
            this.executeSignOut$('strict').pipe(
              catchError((err) =>
                this.handleVoluntarySignOutFailure$(err, pushState)
              )
            )
          ),
          switchMap(() => this.clearLocalSessionDataBestEffort$()),
          switchMap(() => this.navigateBestEffort$('/login'))
        )
      ),
      finalize(() => {
        if (this.terminationInFlight$ === shared$) {
          this.terminationInFlight$ = null;
        }

        /**
         * Sucesso: Firebase já está nulo e liberamos o estado transitório.
         * Falha voluntária: o handler já restaurou a sessão antes de propagar erro.
         */
        if (!this.auth.currentUser) {
          this.authSession.endTermination();
        }
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

  /**
   * Invalidação restrita ao bootstrap do Firebase Auth.
   *
   * Não executa navegação, Presence, geolocalização ou callable de Web Push:
   * esses side-effects não devem ser inicializados apenas para remover uma
   * sessão restaurada inválida/ghost antes do bootstrap da aplicação terminar.
   *
   * A chamada bruta ao Firebase `signOut` continua encapsulada neste serviço e
   * a limpeza local sensível é preservada para impedir vazamento entre contas.
   */
  invalidateRestoredSessionForBootstrap$(): Observable<void> {
    return this.executeSignOut$('strict').pipe(
      switchMap(() => this.clearLocalSessionDataBestEffort$()),
      catchError((err) => {
        this.reportSilent(err, {
          phase: 'invalidateRestoredSessionForBootstrap$',
        });
        return throwError(() => err);
      })
    );
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

    const url = this.router.url || '';

    if (!this.inRegistrationFlow(url)) {
      this.errorNotifier.showError(
        'Sua sessão foi encerrada. Faça login novamente.'
      );
    }

    let shared$: Observable<void>;

    shared$ = defer(() => {
      this.authSession.beginTermination();
      return this.stopGeolocationBestEffort$();
    }).pipe(
      switchMap(() => this.stopPresenceBestEffort$()),
      switchMap(() => this.deactivatePushBestEffort$()),
      switchMap(() => this.executeSignOut$('best-effort')),
      switchMap(() => this.clearLocalSessionDataBestEffort$()),
      switchMap(() => this.navigateToWelcomeBestEffort$(reason)),
      catchError((err) => {
        this.reportSilent(err, { phase: 'hardSignOutToWelcome$', reason });
        return of(void 0);
      }),
      finalize(() => {
        if (this.terminationInFlight$ === shared$) {
          this.terminationInFlight$ = null;
        }

        if (!this.auth.currentUser) {
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
   * Captura somente o estado necessário para rollback do logout voluntário.
   * Não lê token, UID ou conteúdo de notificação.
   */
  private capturePushStateBestEffort$(): Observable<PushNotificationDeviceState> {
    return this.pushNotifications.state$.pipe(
      take(1),
      defaultIfEmpty('inactive' as PushNotificationDeviceState),
      catchError((err) => {
        this.reportSilent(err, { phase: 'capturePushStateBestEffort$' });
        return of('inactive' as PushNotificationDeviceState);
      })
    );
  }

  /**
   * Falha de signOut voluntário não pode deixar a conta autenticada com Presence,
   * geolocalização/Store já desmontados. Primeiro reexpomos a sessão canônica;
   * os orquestradores rearmam seus próprios recursos. Web Push é o único recurso
   * que precisa de restauração explícita porque `deactivate$()` remove o opt-in.
   */
  private handleVoluntarySignOutFailure$(
    err: unknown,
    previousPushState: PushNotificationDeviceState
  ): Observable<void> {
    if (!this.auth.currentUser) {
      // O Firebase já ficou nulo apesar da rejeição: prossegue como logout efetivo.
      return of(void 0);
    }

    this.authSession.endTermination();

    return this.restorePushAfterFailedSignOutBestEffort$(previousPushState).pipe(
      switchMap(() => {
        this.applicationError.report(err, {
          feature: 'auth',
          operation: 'logout',
          fallbackMessage: 'Não foi possível sair agora. Tente novamente.',
          notification: 'error',
          metadata: {
            sessionRestored: true,
          },
        });

        return throwError(() => err);
      })
    );
  }

  /**
   * Restaura Web Push sem abrir prompt: só tentamos `activate$()` quando o estado
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

    return defer(() => this.pushNotifications.activate$()).pipe(
      take(1),
      defaultIfEmpty('inactive' as PushNotificationDeviceState),
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

  private navigateBestEffort$(path: string): Observable<void> {
    return from(
      this.router.navigate([path], { replaceUrl: true })
    ).pipe(
      catchError((err) => {
        this.reportSilent(err, { phase: 'navigateBestEffort$', path });
        return of(false);
      }),
      map(() => void 0)
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
    try {
      this.dbg('reportSilent()', {
        context,
        error: err,
      });

      const error = new Error('[LogoutService] internal error');
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).original = err;
      (error as any).context = context;

      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
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
  private clearLocalSessionDataBestEffort$(): Observable<void> {
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
        this.appBlock.clear();
        this.currentUserStore.clear();
        return void 0;
      })
    );
  }
}
