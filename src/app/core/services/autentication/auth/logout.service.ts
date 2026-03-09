// src/app/core/services/autentication/auth/logout.service.ts
// =============================================================================
// LOGOUT SERVICE (Auth-only)
//
// Objetivo:
// - Centralizar o fluxo completo de logout (voluntário) e signOut inevitável (auth-invalid).
// - Rotinas indissociáveis: parar presença (best-effort), signOut, limpar store, navegar, notificar.
// - Pode ser usado DIRETO por componentes/services/facade (sem passar pelo Orchestrator).
//
// Regras do seu app:
// - Logout voluntário: navega para /login.
// - SignOut inevitável (Auth inválido): navega para /register/welcome?reason=auth-invalid.
// - Erros: sempre roteados ao GlobalErrorHandlerService (silent) + feedback via ErrorNotificationService quando fizer sentido.
//
// Ajuste (AngularFire):
// - `signOut()` do @angular/fire/auth precisa rodar dentro de Injection Context.
// - Sem isso, o AngularFire avisa que pode haver bugs sutis de change-detection/hydration.
// - Solução: `runInInjectionContext(envInjector, () => signOut(auth))`.
// =============================================================================
import { Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { Auth, signOut } from '@angular/fire/auth';

import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, defaultIfEmpty, finalize, map, switchMap, take, tap } from 'rxjs/operators';

import { PresenceService } from '@core/services/presence/presence.service';
import { CurrentUserStoreService } from './current-user-store.service';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { inRegistrationFlow as isRegFlow, type TerminateReason } from './auth.types';

import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class LogoutService {
  private readonly debug = !environment.production;
  private running = false;

  constructor(
    private readonly auth: Auth,
    private readonly router: Router,
    private readonly presence: PresenceService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly envInjector: EnvironmentInjector
  ) { }

  logout$(): Observable<void> {
    if (this.running) return of(void 0);
    this.running = true;

    return this.stopPresenceBestEffort$().pipe(
      switchMap(() => this.signOutStrict$()),
      tap(() => {
        // limpa somente após signOut real
        this.currentUserStore.clear();
      }),
      switchMap(() => this.navigateBestEffort$('/login')),
      map(() => void 0),
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
    this.logout$().pipe(take(1)).subscribe({ next: () => { }, error: () => { } });
  }

  private inRegistrationFlow(url: string): boolean {
    return isRegFlow(url);
  }

  hardSignOutToWelcome$(reason: TerminateReason = 'auth-invalid'): Observable<void> {
    if (this.running) return of(void 0);
    this.running = true;

    const url = this.router.url || '';
    if (!this.inRegistrationFlow(url)) {
      this.errorNotifier.showError('Sua sessão foi encerrada. Faça login novamente.');
    }

    return this.stopPresenceBestEffort$().pipe(
      switchMap(() => this.signOutBestEffort$()),
      tap(() => this.currentUserStore.clear()),
      switchMap(() =>
        from(
          this.router.navigate(['/register/welcome'], {
            queryParams: { reason, autocheck: '1' },
            replaceUrl: true,
          })
        ).pipe(
          catchError((err) => {
            this.reportSilent(err, { phase: 'hardSignOutToWelcome$.navigate', reason });
            return of(false);
          }),
          map(() => void 0)
        )
      ),
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
    this.hardSignOutToWelcome$(reason).pipe(take(1)).subscribe({ next: () => { }, error: () => { } });
  }

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
   * Logout voluntário precisa de signOut estrito.
   * Se falhar, não devemos limpar store nem fingir que saiu.
   */
  private signOutStrict$(): Observable<void> {
    return defer(() =>
      from(
        runInInjectionContext(this.envInjector, () => signOut(this.auth))
      )
    ).pipe(
      map(() => void 0)
    );
  }

  /**
   * Hard signout pode continuar best-effort.
   * Serve para cenários de sessão inválida.
   */
  private signOutBestEffort$(): Observable<void> {
    return defer(() =>
      from(
        runInInjectionContext(this.envInjector, () => signOut(this.auth))
      )
    ).pipe(
      catchError((err) => {
        this.reportSilent(err, { phase: 'signOutBestEffort$' });
        return of(void 0);
      }),
      map(() => void 0)
    );
  }

  private navigateBestEffort$(path: string): Observable<void> {
    return from(this.router.navigate([path], { replaceUrl: true })).pipe(
      catchError((err) => {
        this.reportSilent(err, { phase: 'navigateBestEffort$', path });
        return of(false);
      }),
      map(() => void 0)
    );
  }

  private reportSilent(err: any, context: any): void {
    try {
      if (this.debug) {
        console.log('[LogoutService]', context, err);
      }

      const e = new Error('[LogoutService] internal error');
      (e as any).silent = true;
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch { }
  }
} // Linha 187, fim do LogoutService

