// src/app/core/guards/guest-only.guard.ts
// =============================================================================
// GUEST-ONLY (CanMatch + CanActivate)
//
// Padrão "grandes plataformas":
// - canMatch: bloqueia ANTES do lazy-load => não baixa o bundle de /login e /register.
// - canActivate: segunda barreira (snapshot-aware) => respeita allowAuthenticated nos filhos.
// - Espera authStateReady() => evita flicker / decisões com currentUser null no boot.
// - Usa AuthReturnUrlService => manda o usuário autenticado para o "último destino útil".
// - Fail-open em erro => evita lock-out (usuário preso sem conseguir entrar/sair).
// =============================================================================

import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  CanMatchFn,
  Route,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { defer, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';
import { AuthReturnUrlService } from '../../services/autentication/auth/auth-return-url.service';
import { environment } from 'src/environments/environment';

function routeOrChildrenAllowAuthenticated(route: ActivatedRouteSnapshot): boolean {
  if (route.data?.['allowAuthenticated'] === true) return true;
  for (const child of route.children ?? []) {
    if (routeOrChildrenAllowAuthenticated(child)) return true;
  }
  return false;
}

/**
 * Para canMatch (antes do lazy-load) não temos snapshot.
 * Então usamos um allowlist definido no AppRouting via:
 * data: { guestAllowAuthenticatedPaths: ['welcome','verify'] }
 */
function canMatchAllowsAuthenticated(route: Route, segments: UrlSegment[]): boolean {
  const allow = (route.data?.['guestAllowAuthenticatedPaths'] as string[] | undefined) ?? [];
  if (!allow.length) return false;

  // /register/welcome => segments[0]=register, segments[1]=welcome
  const sub = segments?.[1]?.path ?? '';
  return !!sub && allow.includes(sub);
}

function decideGuestAccess$(
  params: {
    attemptedUrl: string;
    allowAuthenticatedHere: boolean;
    redirectToParam: string | null;
  }
) {
  const router = inject(Router);
  const auth = inject(Auth);
  const globalErrorHandler = inject(GlobalErrorHandlerService);
  const returnUrl = inject(AuthReturnUrlService);

  const enforceVerified = !!environment?.features?.enforceEmailVerified;

  const toAuthedDestination = () => {
    const target = returnUrl.resolveAuthedRedirect(params.redirectToParam, '/dashboard/principal');
    return router.parseUrl(target);
  };

  const toWelcome = () =>
    router.createUrlTree(['/register/welcome'], {
      queryParams: { autocheck: '1', redirectTo: params.redirectToParam || '/dashboard/principal' },
    });

  return defer(() => from((auth as any).authStateReady?.() ?? Promise.resolve())).pipe(
    map(() => auth.currentUser ?? null),
    switchMap((user) => {
      // ✅ visitante -> pode entrar em /login e /register
      if (!user) return of<boolean | UrlTree>(true);

      // ✅ rota/filho explicitamente permitido para autenticado (ex.: /register/welcome)
      if (params.allowAuthenticatedHere) return of<boolean | UrlTree>(true);

      // reload defensivo (não quebra se falhar)
      return defer(() => from(user.reload())).pipe(
        catchError(() => of(void 0)),
        map(() => auth.currentUser ?? user),
        map((refreshed) => {
          // se você exige verificação e ainda não verificou -> manda pro welcome
          if (enforceVerified && !refreshed.emailVerified) return toWelcome();
          // autenticado normal -> manda pro último destino útil
          return toAuthedDestination();
        })
      );
    }),
    catchError((err) => {
      try {
        (err as any).silent = true;
        (err as any).feature = 'auth-guard';
        (err as any).context = { attemptedUrl: params.attemptedUrl, guard: 'guest-only' };
      } catch { }
      globalErrorHandler.handleError(err);

      // fail-open (evita lock-out)
      return of<boolean | UrlTree>(true);
    })
  );
}

// -----------------------------------------------------------------------------
// CanActivate (snapshot-aware)
// -----------------------------------------------------------------------------
export const guestOnlyCanActivate: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  const redirectToParam = route.queryParamMap.get('redirectTo');
  const allowAuthenticatedHere = routeOrChildrenAllowAuthenticated(route);

  return decideGuestAccess$({
    attemptedUrl: state.url,
    allowAuthenticatedHere,
    redirectToParam,
  });
};

// -----------------------------------------------------------------------------
// CanMatch (antes do lazy-load)
// -----------------------------------------------------------------------------
export const guestOnlyCanMatch: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const attemptedUrl = '/' + (segments ?? []).map(s => s.path).filter(Boolean).join('/');
  const allowAuthenticatedHere = canMatchAllowsAuthenticated(route, segments);

  // canMatch não tem queryParamMap, então redirectToParam fica null
  return decideGuestAccess$({
    attemptedUrl,
    allowAuthenticatedHere,
    redirectToParam: null,
  });
};// Linha 143
