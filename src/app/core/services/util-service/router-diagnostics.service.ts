// src/app/core/services/util-service/router-diagnostics.service.ts
// Diagnóstico avançado do Router:
// - taxa de eventos (dev-only)
// - log detalhado (dev-only)
// - detecção real de loop de navegação (redirect/cancel repetitivo)
// - roteamento centralizado de erros (GlobalErrorHandler) + notificação com throttle
import { DestroyRef, Injectable, inject } from '@angular/core';
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
import { EMPTY, Subscription } from 'rxjs';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class RouterDiagnosticsService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly privacyLogging = environment.privacyLogging;
  private readonly debug = this.isRouterDiagnosticsDebugEnabled();

  private lastNotifyAt = 0;
  private started = false;

  // =========================
  // Loop detector state
  // =========================
  private redirectCancelWindow: number[] = []; // timestamps
  private readonly LOOP_WINDOW_MS = 3000;      // janela curta
  private readonly LOOP_THRESHOLD = 6;         // 6 cancels em 3s é forte sinal de loop

  constructor(
    private readonly router: Router,
    private readonly geh: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService
  ) { }

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.startInternal();
  }

private isRouterDiagnosticsDebugEnabled(): boolean {
  if (environment.production) {
    return false;
  }

  if (this.privacyLogging?.enabled !== true) {
    return false;
  }

  /**
   * Router carrega URLs e pode expor UID em rotas.
   *
   * Portanto, debug detalhado do router deve ser opt-in manual.
   *
   * Para ativar:
   * localStorage.setItem('ROUTER_DIAGNOSTICS_DEBUG', '1')
   */
  try {
    return localStorage.getItem('ROUTER_DIAGNOSTICS_DEBUG') === '1';
  } catch {
    return false;
  }
}

private canLogSensitiveConsoleData(): boolean {
  if (environment.production) {
    return false;
  }

  if (this.privacyLogging?.allowSensitiveConsoleData !== true) {
    return false;
  }

  try {
    return localStorage.getItem('ALLOW_SENSITIVE_CONSOLE_DATA') === '1';
  } catch {
    return false;
  }
}

private looksLikeFirebaseUid(value: string): boolean {
  return /^[A-Za-z0-9_-]{18,80}$/.test(value);
}

private looksLikeDirectChatId(value: string): boolean {
  return /^direct_[a-f0-9]{32,128}$/i.test(value);
}

private maskUid(value: unknown): string | null {
  const uid = String(value ?? '').trim();

  if (!uid) {
    return null;
  }

  if (this.canLogSensitiveConsoleData()) {
    return uid;
  }

  if (uid.length <= 8) {
    return 'masked';
  }

  return `${uid.slice(0, 4)}...${uid.slice(-4)}`;
}

private maskDirectChatId(value: string): string {
  if (this.canLogSensitiveConsoleData()) {
    return value;
  }

  return `${value.slice(0, 13)}...${value.slice(-6)}`;
}

private maskSensitiveString(value: unknown): string {
  const text = String(value ?? '');

  if (!text) {
    return text;
  }

  return text
    .split(/([:/?&=|,\s]+)/)
    .map((token) => {
      const cleanToken = token.trim();

      if (!cleanToken) {
        return token;
      }

      if (this.looksLikeDirectChatId(cleanToken)) {
        return this.maskDirectChatId(cleanToken);
      }

      if (this.looksLikeFirebaseUid(cleanToken)) {
        return this.maskUid(cleanToken) ?? 'masked';
      }

      return token;
    })
    .join('');
}

private sanitizeRouterEvent(event: any): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: event?.id ?? null,
    type: event?.constructor?.name ?? 'RouterEvent',
  };

  if (event?.url !== undefined) {
    payload['url'] = this.maskSensitiveString(event.url);
  }

  if (event?.urlAfterRedirects !== undefined) {
    payload['urlAfterRedirects'] = this.maskSensitiveString(event.urlAfterRedirects);
  }

  if (event?.navigationTrigger !== undefined) {
    payload['navigationTrigger'] = event.navigationTrigger;
  }

  if (event?.restoredState !== undefined) {
    payload['hasRestoredState'] = !!event.restoredState;
  }

  if (event?.shouldActivate !== undefined) {
    payload['shouldActivate'] = event.shouldActivate;
  }

  if (event?.reason !== undefined) {
    payload['reason'] = this.maskSensitiveString(event.reason);
  }

  if (event?.error !== undefined) {
    const error = event.error instanceof Error
      ? event.error
      : new Error(String(event.error ?? 'unknown navigation error'));

    payload['error'] = {
      name: error.name,
      message: this.maskSensitiveString(error.message),
    };
  }

  return payload;
}

private dbg(msg: string, extra?: unknown): void {
  if (!this.debug) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[RouterDiagnostics] ${msg}`,
    typeof extra === 'string' ? this.maskSensitiveString(extra) : extra ?? ''
  );
}

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

    // 1) Taxa de eventos por segundo (dev-only)
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

    // 2) Log detalhado (dev-only)
    if (this.debug) {
      const subLog = relevant$.pipe(
        tap((event: any) => {
          // eslint-disable-next-line no-console
          console.log(
            '[ROUTER]',
            event.constructor?.name,
            this.sanitizeRouterEvent(event)
          );
        }),
        catchError(err => {
          this.dbg('log stream error', err);
          return EMPTY;
        })
      ).subscribe();

      this.destroyRef.onDestroy(() => subLog.unsubscribe());
    }

    // 3) Detector de falhas/cancelamentos relevantes (sempre ativo)
    const subErrors = relevant$.pipe(
      filter(e => e instanceof NavigationCancel || e instanceof NavigationError),
      tap((e: any) => this.handleNavigationFailure(e))
    ).subscribe();

    this.destroyRef.onDestroy(() => subErrors.unsubscribe());
  }

  private handleNavigationFailure(e: NavigationCancel | NavigationError): void {
    if (e instanceof NavigationCancel) {
      const reason = String((e as any).reason ?? '');
      const isRedirect = reason.includes('Redirecting to');

      // Redirect isolado é normal.
      // O que importa é REDIRECT EM LOOP (muitos em janela curta).
      if (isRedirect) {
        this.bumpRedirectCancelLoopCounter();
        return;
      }

      // Cancel “não redirect” pode ser sinal de problema (guard/resolve).
      // Mantém log (dev) e reporta como silent para não spammar.
      this.reportSilent('NavigationCancel (non-redirect)', e);
      return;
    }

    // NavigationError sempre é relevante
    if (e instanceof NavigationError) {
      this.reportNotSilent('NavigationError', e?.error ?? e);
      this.notifyThrottled('Falha de navegação detectada. Veja o console.');
      return;
    }
  }

  /**
   * Detector real de loop:
   * - Conta NavigationCancel por redirect em uma janela curta.
   * - Se ultrapassar limiar, reporta e notifica 1x.
   */
  private bumpRedirectCancelLoopCounter(): void {
    const now = Date.now();
    this.redirectCancelWindow.push(now);

    // Mantém somente eventos dentro da janela
    this.redirectCancelWindow = this.redirectCancelWindow.filter(t => (now - t) <= this.LOOP_WINDOW_MS);

    if (this.redirectCancelWindow.length >= this.LOOP_THRESHOLD) {
      const err = new Error(
        `Possível loop de redirect: ${this.redirectCancelWindow.length} cancels em ${this.LOOP_WINDOW_MS}ms`
      );
      (err as any).context = { threshold: this.LOOP_THRESHOLD, windowMs: this.LOOP_WINDOW_MS };

      // Isso NÃO é "contorno": é detecção objetiva de bug.
      this.reportNotSilent('RedirectLoopSuspected', err);
      this.notifyThrottled('Loop de navegação suspeito detectado. Verifique guards/redirects.');

      // Zera para não notificar em avalanche
      this.redirectCancelWindow = [];
    }
  }

  private reportSilent(context: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    (e as any).silent = true;
    (e as any).context = context;
    try { this.geh.handleError(e); } catch { }
  }

  private reportNotSilent(context: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    (e as any).silent = false;
    (e as any).context = context;
    try { this.geh.handleError(e); } catch { }
  }

  private notifyThrottled(msg: string): void {
    const now = Date.now();
    if (now - this.lastNotifyAt < 10_000) return;
    this.lastNotifyAt = now;
    this.notify.showError(msg);
  }
}
