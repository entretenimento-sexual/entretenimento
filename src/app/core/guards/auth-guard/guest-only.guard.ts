// src/app/core/guards/auth-guard/guest-only.guard.ts
// Guard de acesso: permite rota apenas para usuários NÃO autenticados (visitantes).
// Boas práticas:
// - One-shot: take(1) (conclui rápido)
// - Fail-safe: catchError -> redireciona com segurança e registra no GlobalErrorHandler
// - Permite rotas específicas para autenticados via data.allowAuthenticated ou data.guestAllowAuthenticatedPaths
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
  GuardResult,
} from '@angular/router';
import { defer, of, type Observable } from 'rxjs';
import { catchError, filter, map, switchMap, take } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';
import { AuthReturnUrlService } from '../../services/autentication/auth/auth-return-url.service';
import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { environment } from 'src/environments/environment';

function routeOrChildrenAllowAuthenticated(route: ActivatedRouteSnapshot): boolean {
  if (route.data?.['allowAuthenticated'] === true) return true;
  for (const child of route.children ?? []) {
    if (routeOrChildrenAllowAuthenticated(child)) return true;
  }
  return false;
}

function canMatchAllowsAuthenticated(route: Route, segments: UrlSegment[]): boolean {
  const allow = (route.data?.['guestAllowAuthenticatedPaths'] as string[] | undefined) ?? [];
  if (!allow.length) return false;
  const sub = segments?.[1]?.path ?? '';
  return !!sub && allow.includes(sub);
}

function decideGuestAccess$(
  params: {
    attemptedUrl: string;
    allowAuthenticatedHere: boolean;
    redirectToParam: string | null;
  }
): Observable<GuardResult> {
  const router = inject(Router);
  const geh = inject(GlobalErrorHandlerService);
  const returnUrl = inject(AuthReturnUrlService);
  const session = inject(AuthSessionService);

  const enforceVerified = !!environment?.features?.enforceEmailVerified;

  const toAuthedDestination = () => {
    const target = returnUrl.resolveAuthedRedirect(params.redirectToParam, '/dashboard/principal');
    return router.parseUrl(target);
  };

  const toWelcome = () =>
    router.createUrlTree(['/register/welcome'], {
      queryParams: { autocheck: '1', redirectTo: params.redirectToParam || '/dashboard/principal' },
    });

  // Espera o AuthSession ficar pronto e pega snapshot do usuário (1x)
  return session.ready$.pipe(
    filter(Boolean),
    take(1),
    switchMap(() => session.authUser$.pipe(take(1))),
    map((user) => {
      // visitante -> pode entrar em /login e /register
      if (!user) return true;

      // rota explicitamente permitida (ex.: /register/welcome)
      if (params.allowAuthenticatedHere) return true;

      // se exige verificação e ainda não está verificado -> manda pro welcome
      if (enforceVerified && user.emailVerified !== true) return toWelcome();

      // autenticado normal -> manda pro último destino útil
      return toAuthedDestination();
    }),
    catchError((err) => {
      try {
        (err as any).silent = true;
        (err as any).feature = 'auth-guard';
        (err as any).context = { attemptedUrl: params.attemptedUrl, guard: 'guest-only' };
      } catch { }
      geh.handleError(err);

      // fail-open (evita lock-out)
      return of(true);
    })
  );
}

// CanActivate
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

// CanMatch
export const guestOnlyCanMatch: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const attemptedUrl = '/' + (segments ?? []).map(s => s.path).filter(Boolean).join('/');
  const allowAuthenticatedHere = canMatchAllowsAuthenticated(route, segments);

  return decideGuestAccess$({
    attemptedUrl,
    allowAuthenticatedHere,
    redirectToParam: null,
  });
}; // Linha 123
// Não esqueça os comentários explicativos sobre o propósito desse guard e boas práticas.
