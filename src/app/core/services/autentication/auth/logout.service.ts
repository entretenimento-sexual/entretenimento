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

import { Observable, defer, from, of } from 'rxjs';
import { catchError, defaultIfEmpty, finalize, map, switchMap, take } from 'rxjs/operators';

import { PresenceService } from '@core/services/presence/presence.service';
import { CurrentUserStoreService } from './current-user-store.service';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { inRegistrationFlow as isRegFlow, type TerminateReason } from './auth.types';

import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class LogoutService {
  private readonly debug = !environment.production;

  // evita reentrância: dois cliques rápidos, múltiplos gatilhos de UI, etc.
  private running = false;

  constructor(
    private readonly auth: Auth,
    private readonly router: Router,
    private readonly presence: PresenceService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,

    // Necessário para garantir Injection Context nas APIs do AngularFire
    private readonly envInjector: EnvironmentInjector
  ) { }

  // ===========================================================================
  // Logout voluntário (único “logout normal”)
  // ===========================================================================

  logout$(): Observable<void> {
    if (this.running) return of(void 0);
    this.running = true;

    // Para UX: logout voluntário normalmente não precisa toast de erro.
    return this.stopPresenceBestEffort$().pipe(
      switchMap(() => this.signOutBestEffort$()),
      finalize(() => {
        // indissociável: limpar estado do app sempre que tentamos sair
        this.currentUserStore.clear();
      }),
      switchMap(() => this.navigateBestEffort$('/login')),
      finalize(() => {
        this.running = false;
      }),
      map(() => void 0),
      catchError((err) => {
        this.reportSilent(err, { phase: 'logout$' });
        this.running = false;
        return of(void 0);
      })
    );
  }

  logout(): void {
    this.logout$().pipe(take(1)).subscribe({ next: () => { }, error: () => { } });
  }

  private inRegistrationFlow(url: string): boolean {
    return isRegFlow(url);
  }

  // ===========================================================================
  // SignOut inevitável (apenas Auth inválido)
  // ===========================================================================

  hardSignOutToWelcome$(reason: TerminateReason = 'auth-invalid'): Observable<void> {
    if (this.running) return of(void 0);
    this.running = true;

    const url = this.router.url || '';
    if (!this.inRegistrationFlow(url)) {
      this.errorNotifier.showError('Sua sessão foi encerrada. Faça login novamente.');
    }

    return this.stopPresenceBestEffort$().pipe(
      switchMap(() => this.signOutBestEffort$()),
      finalize(() => this.currentUserStore.clear()),
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
      finalize(() => { this.running = false; }),
      catchError((err) => {
        this.reportSilent(err, { phase: 'hardSignOutToWelcome$', reason });
        this.running = false;
        return of(void 0);
      })
    );
  }

  hardSignOutToWelcome(reason: TerminateReason = 'auth-invalid'): void {
    this.hardSignOutToWelcome$(reason).pipe(take(1)).subscribe({ next: () => { }, error: () => { } });
  }

  // ===========================================================================
  // Internals (best-effort)
  // ===========================================================================

  private stopPresenceBestEffort$(): Observable<void> {
    // PresenceService já é defensivo: se não estiver ativo, retorna void 0.
    return this.presence.stop$().pipe(
      take(1),
      defaultIfEmpty(void 0),
      catchError((err) => {
        this.reportSilent(err, { phase: 'stopPresenceBestEffort$' });
        return of(void 0);
      })
    );
  }

  private signOutBestEffort$(): Observable<void> {
    /**
     * IMPORTANTE (AngularFire):
     * - o `signOut()` de @angular/fire/auth precisa rodar dentro de Injection Context.
     * - `runInInjectionContext` garante que o AngularFire consiga “amarrar” Zone/PendingTasks.
     * - `defer` garante execução lazy (somente no subscribe), evitando side-effects antecipados.
     */
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
        // eslint-disable-next-line no-console
        console.log('[LogoutService]', context, err);
      }
      const e = new Error('[LogoutService] internal error');
      (e as any).silent = true;
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch { }
  }
} // Linha 194
