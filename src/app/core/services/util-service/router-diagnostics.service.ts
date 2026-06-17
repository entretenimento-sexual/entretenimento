// src/app/core/services/util-service/router-diagnostics.service.ts
// Diagnóstico avançado do Router:
// - taxa de eventos e log detalhado apenas em debug opt-in
// - detecção real de loop de navegação
// - roteamento centralizado de erros com payload sanitizado
// - notificação profissional e controlada por throttle
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
import { EMPTY } from 'rxjs';

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

  private redirectCancelWindow: number[] = [];
  private readonly LOOP_WINDOW_MS = 3000;
  private readonly LOOP_THRESHOLD = 6;
  private readonly NOTIFICATION_THROTTLE_MS = 10_000;

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
     * Debug detalhado fica opt-in manual.
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

      if (isRedirect) {
        this.bumpRedirectCancelLoopCounter();
        return;
      }

      this.reportSilent('NavigationCancel', e, e);
      return;
    }

    if (e instanceof NavigationError) {
      this.reportNotSilent('NavigationError', e?.error ?? e, e);
      this.notifyThrottled('Não foi possível concluir a navegação. Tente novamente.');
      return;
    }
  }

  private bumpRedirectCancelLoopCounter(): void {
    const now = Date.now();
    this.redirectCancelWindow.push(now);

    this.redirectCancelWindow = this.redirectCancelWindow.filter(t => (now - t) <= this.LOOP_WINDOW_MS);

    if (this.redirectCancelWindow.length >= this.LOOP_THRESHOLD) {
      const err = new Error(
        `Possível loop de redirect: ${this.redirectCancelWindow.length} cancels em ${this.LOOP_WINDOW_MS}ms`
      );
      (err as any).context = { threshold: this.LOOP_THRESHOLD, windowMs: this.LOOP_WINDOW_MS };

      this.reportNotSilent('RedirectLoopSuspected', err);
      this.notifyThrottled('A navegação ficou instável. Recarregue a página se persistir.');

      this.redirectCancelWindow = [];
    }
  }

  private reportSilent(context: string, err: unknown, event?: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    (e as any).silent = true;
    (e as any).skipUserNotification = true;
    (e as any).context = this.buildErrorContext(context, event);
    try { this.geh.handleError(e); } catch { }
  }

  private reportNotSilent(context: string, err: unknown, event?: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    (e as any).silent = false;
    (e as any).skipUserNotification = true;
    (e as any).context = this.buildErrorContext(context, event);
    try { this.geh.handleError(e); } catch { }
  }

  private buildErrorContext(context: string, event?: unknown): Record<string, unknown> {
    return {
      scope: 'RouterDiagnosticsService',
      context,
      ...(event ? { routerEvent: this.sanitizeRouterEvent(event) } : {}),
    };
  }

  private notifyThrottled(msg: string): void {
    const now = Date.now();
    if (now - this.lastNotifyAt < this.NOTIFICATION_THROTTLE_MS) return;
    this.lastNotifyAt = now;

    try {
      this.notify.showError(msg);
    } catch {
      // noop
    }
  }
}
