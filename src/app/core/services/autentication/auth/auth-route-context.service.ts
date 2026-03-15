// src/app/core/services/autentication/auth/auth-route-context.service.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  tap,
} from 'rxjs/operators';

import { inRegistrationFlow as isRegistrationFlow } from './auth.types';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

export type AuthRouteContext = {
  routerReady: boolean;
  currentUrl: string;
  navPath: string | null;
  inRegistrationFlow: boolean;
};

@Injectable({ providedIn: 'root' })
export class AuthRouteContextService {
  private readonly router = inject(Router);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly debug = !environment.production;

  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthRouteContext] ${msg}`, extra ?? '');
  }

  private stripQueryAndHash(url: string): string {
    const raw = (url ?? '/').trim() || '/';
    const q = raw.indexOf('?');
    const h = raw.indexOf('#');
    const cut = Math.min(q === -1 ? raw.length : q, h === -1 ? raw.length : h);
    const path = raw.slice(0, cut);
    return path || '/';
  }

  private isRegistrationPath(path: string | null): boolean {
    if (!path) return true;
    if (isRegistrationFlow(path)) return true;
    if (/^\/login(\/|$)/.test(path)) return true;
    return false;
  }

  private buildContext(url: string, routerReady: boolean): AuthRouteContext {
    const currentUrl = (url ?? '/').trim() || '/';
    const navPath = routerReady ? this.stripQueryAndHash(currentUrl) : null;

    return {
      routerReady,
      currentUrl,
      navPath,
      inRegistrationFlow: routerReady ? this.isRegistrationPath(navPath) : true,
    };
  }

  private handleStreamError<T>(context: string, fallback: T): (err: unknown) => Observable<T> {
    return (err: unknown) => {
      const e =
        err instanceof Error
          ? err
          : new Error(`AuthRouteContextService stream error: ${context}`);

      (e as any).silent = true;
      (e as any).skipUserNotification = true;
      (e as any).original = err;
      (e as any).context = context;

      this.globalError.handleError(e);
      return of(fallback);
    };
  }

  /**
   * Fonte única e atômica do contexto de rota.
   *
   * Importante:
   * - evita combinações inconsistentes entre currentUrl$, routerReady$ e inRegistrationFlow$
   * - cada emissão representa um snapshot coeso do Router
   */
  readonly context$: Observable<AuthRouteContext> = this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    map((e) => this.buildContext(e.urlAfterRedirects || e.url || '/', true)),
    startWith(this.buildContext(this.router.url || '/', this.router.navigated === true)),
    distinctUntilChanged((a, b) =>
      a.routerReady === b.routerReady &&
      a.currentUrl === b.currentUrl &&
      a.navPath === b.navPath &&
      a.inRegistrationFlow === b.inRegistrationFlow
    ),
    tap((ctx) => this.dbg('context$', ctx)),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(
      this.handleStreamError<AuthRouteContext>(
        'context$',
        this.buildContext(this.router.url || '/', false)
      )
    )
  );

  readonly currentUrl$: Observable<string> = this.context$.pipe(
    map((ctx) => ctx.currentUrl),
    distinctUntilChanged()
  );

  readonly routerReady$: Observable<boolean> = this.context$.pipe(
    map((ctx) => ctx.routerReady),
    distinctUntilChanged()
  );

  readonly navPath$: Observable<string | null> = this.context$.pipe(
    map((ctx) => ctx.navPath),
    distinctUntilChanged()
  );

  readonly inRegistrationFlow$: Observable<boolean> = this.context$.pipe(
    map((ctx) => ctx.inRegistrationFlow),
    distinctUntilChanged()
  );
} // Linha 130
