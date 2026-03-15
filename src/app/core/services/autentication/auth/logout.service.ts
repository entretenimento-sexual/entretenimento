// src/app/core/services/autentication/auth/logout.service.ts
// =============================================================================
// LOGOUT SERVICE (Auth-only)
//
// Objetivo:
// - Centralizar logout voluntário e hard signout inevitável.
// - Coordenar side-effects que pertencem ao encerramento da sessão:
//   presença, signOut, limpeza de perfil runtime e navegação.
//
// Fonte de verdade:
// - AuthSessionService = sessão
// - LogoutService = execução do encerramento da sessão
//
// Regras do app:
// - Logout voluntário -> /login
// - Sessão inválida tecnicamente -> /register/welcome?reason=auth-invalid
//
// Observação:
// - Firestore/negócio NÃO deve forçar signOut aqui.
// - Este service existe para logout real, não para bloqueio de app.
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
  switchMap,
  take,
} from 'rxjs/operators';

import { PresenceService } from '@core/services/presence/presence.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { AuthAppBlockService } from './auth-app-block.service';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { inRegistrationFlow as isRegFlow, type TerminateReason } from './auth.types';

import { environment } from 'src/environments/environment';

type SignOutMode = 'strict' | 'best-effort';

@Injectable({ providedIn: 'root' })
export class LogoutService {
  private readonly debug = !environment.production;
  private running = false;

  constructor(
    private readonly auth: Auth,
    private readonly router: Router,
    private readonly presence: PresenceService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly appBlock: AuthAppBlockService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly envInjector: EnvironmentInjector
  ) {}

  /**
   * Logout voluntário:
   * - para presença
   * - faz signOut estrito
   * - limpa CurrentUserStore
   * - limpa bloqueio de app
   * - navega para /login
   *
   * Se o signOut falhar, o fluxo falha junto.
   * Não devemos “fingir” que saiu.
   */
  logout$(): Observable<void> {
    if (this.running) return of(void 0);
    this.running = true;

    return this.stopPresenceBestEffort$().pipe(
      switchMap(() => this.executeSignOut$('strict')),
      map(() => {
        this.appBlock.clear();
        this.currentUserStore.clear();
        return void 0;
      }),
      switchMap(() => this.navigateBestEffort$('/login')),
      catchError((err) => {
        this.reportSilent(err, { phase: 'logout$' });
        return throwError(() => err);
      }),
      finalize(() => {
        this.running = false;
      })
    );
  }

  logout(): void {
    this.logout$().pipe(take(1)).subscribe({
      next: () => {},
      error: () => {},
    });
  }

  /**
   * Hard signout:
   * - usado quando a sessão do Auth ficou tecnicamente inválida
   * - tenta parar presença
   * - faz signOut best-effort
   * - limpa CurrentUserStore
   * - limpa bloqueio de app
   * - redireciona para welcome com reason
   *
   * Aqui a prioridade é recuperar coerência do app.
   */
  hardSignOutToWelcome$(
    reason: TerminateReason = 'auth-invalid'
  ): Observable<void> {
    if (this.running) return of(void 0);
    this.running = true;

    const url = this.router.url || '';

    if (!this.inRegistrationFlow(url)) {
      this.errorNotifier.showError(
        'Sua sessão foi encerrada. Faça login novamente.'
      );
    }

    return this.stopPresenceBestEffort$().pipe(
      switchMap(() => this.executeSignOut$('best-effort')),
      map(() => {
        this.appBlock.clear();
        this.currentUserStore.clear();
        return void 0;
      }),
      switchMap(() => this.navigateToWelcomeBestEffort$(reason)),
      catchError((err) => {
        this.reportSilent(err, { phase: 'hardSignOutToWelcome$', reason });
        return of(void 0);
      }),
      finalize(() => {
        this.running = false;
      })
    );
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
   * Para presença antes do signOut.
   * Best-effort por definição:
   * se falhar, não bloqueia o encerramento da sessão.
   */
  private stopPresenceBestEffort$(): Observable<void> {
    return this.presence.stop$().pipe(
      take(1),
      defaultIfEmpty(void 0),
      catchError((err) => {
        this.reportSilent(err, { phase: 'stopPresenceBestEffort$' });
        return of(void 0);
      })
    );
  }

  /**
   * Executor único do signOut.
   *
   * strict:
   * - falha o fluxo se o signOut falhar
   *
   * best-effort:
   * - registra o erro, mas devolve void para permitir recuperação do app
   */
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

  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    try {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log('[LogoutService]', context, err);
      }

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
} // Linha 253, fim do logout.service.ts
// Verificar migrações de responsabilidades para o:
// 1 - auth-route-context.service.ts, e;
// 2 - auth-user-document-watch.service.ts, e;
// 3 - auth-session-monitor.service.ts.
