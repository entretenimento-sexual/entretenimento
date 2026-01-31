// src/app/core/services/util-service/router-diagnostics.service.ts
// Serviço para diagnóstico avançado do roteador Angular.
// Fornece logging detalhado, monitoramento de taxa de eventos e tratamento centralizado de erros de navegação.
// Não esquecer os comentários explicativos.
import { DestroyRef, Injectable, inject, isDevMode } from '@angular/core';
import {
  Router,
  NavigationStart,
  NavigationEnd,
  NavigationCancel,
  NavigationError,
  RoutesRecognized,
  GuardsCheckStart,
  GuardsCheckEnd,
  ResolveStart,
  ResolveEnd,
} from '@angular/router';
import { filter, map, pairwise, scan, share, startWith, tap, auditTime, catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class RouterDiagnosticsService {
  private readonly destroyRef = inject(DestroyRef);

  // Debug apenas em dev
  private readonly debug = isDevMode();

  // Throttle simples p/ não spammar UX em loops de cancel/error
  private lastNotifyAt = 0;

  // ✅ garante que start() rode apenas uma vez
  private started = false;

  constructor(
    private readonly router: Router,
    private readonly geh: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService
  ) { }

  /**
   * ✅ Inicialização explícita (idempotente).
   * Chame isso no AppComponent (ou via APP_INITIALIZER) para garantir que o serviço esteja ativo.
   */
  public start(): void {
    if (this.started) return;
    this.started = true;
    this.startInternal();
  }

  /** Log “controlado” (não quebra build e evita ruído em produção) */
  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[RouterDiagnostics] ${msg}`, extra ?? '');
  }

  /** Loop principal (streams do Router + tratamento centralizado de falhas). */
  private startInternal(): void {
    const relevant$ = this.router.events.pipe(
      filter(e =>
        e instanceof NavigationStart ||
        e instanceof RoutesRecognized ||
        e instanceof GuardsCheckStart ||
        e instanceof GuardsCheckEnd ||
        e instanceof ResolveStart ||
        e instanceof ResolveEnd ||
        e instanceof NavigationEnd ||
        e instanceof NavigationCancel ||
        e instanceof NavigationError
      ),
      share()
    );

    // 1) Taxa de eventos por segundo (somente debug)
    if (this.debug) {
      const subRate = relevant$.pipe(
        map(() => 1),
        scan((acc, n) => acc + n, 0),
        auditTime(1000),
        startWith(0),
        pairwise(),
        map(([prev, curr]) => curr - prev),
        tap(rate => this.dbg('router events/sec', rate)),
        catchError(err => {
          this.dbg('rate stream error', err);
          return EMPTY;
        })
      ).subscribe();

      this.destroyRef.onDestroy(() => subRate.unsubscribe());
    }

    // 2) Log detalhado de eventos (somente debug)
    if (this.debug) {
      const subLog = relevant$.pipe(
        tap((e: any) => {
          // eslint-disable-next-line no-console
          console.log('[ROUTER]', e.constructor?.name, e);
        }),
        catchError(err => {
          this.dbg('log stream error', err);
          return EMPTY;
        })
      ).subscribe();

      this.destroyRef.onDestroy(() => subLog.unsubscribe());
    }

    // 3) Tratamento de cancel/error (sempre ativo)
    const subErrors = relevant$.pipe(
      filter(e => e instanceof NavigationCancel || e instanceof NavigationError),
      tap((e: any) => this.handleNavigationFailure(e))
    ).subscribe();

    this.destroyRef.onDestroy(() => subErrors.unsubscribe());
  }

  private handleNavigationFailure(e: NavigationCancel | NavigationError): void {
    // NavigationCancel pode ser fluxo normal (redirect de guard)
    if (e instanceof NavigationCancel) {
      const reason = String((e as any).reason ?? '');
      // eslint-disable-next-line no-console
      console.log('[ROUTER][CANCEL]', {
        id: e.id,
        url: e.url,
        reason: (e as any).reason,
        code: (e as any).code,
      });

      // Redirect é esperado — não notificar como erro
      if (reason.includes('Redirecting to')) return;
    }

    // NavigationError
    if (e instanceof NavigationError) {
      // eslint-disable-next-line no-console
      console.log('[ROUTER][ERROR]', { id: e.id, url: e.url, error: e.error });
    }

    // Centraliza no handler global
    const err = (e as any)?.error ?? e;
    try {
      (this.geh as any)?.handleError?.(err, 'RouterDiagnostics');
    } catch {
      try {
        this.geh.handleError(err instanceof Error ? err : new Error('RouterDiagnostics: navigation failure'));
      } catch { /* noop */ }
    }

    // Notificação com throttle (UX)
    const now = Date.now();
    if (now - this.lastNotifyAt > 10_000) {
      this.lastNotifyAt = now;
      this.notify.showError('Falha de navegação detectada. Veja o console.');
    }
  }
} // Linha 160
/*
C:.
    auth-debug.service.ts
    router-diagnostics.service.ts
    TokenService.ts

Não existem subpastas
*/
