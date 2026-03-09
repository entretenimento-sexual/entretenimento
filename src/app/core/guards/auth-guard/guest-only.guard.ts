// src/app/core/guards/auth-guard/guest-only.guard.ts
// Guard de visitante:
// - permite /login e /register apenas para quem NÃO está autenticado
// - redireciona autenticado conforme estado real da conta
import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  CanMatchFn,
  Route,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  GuardResult,
} from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { AuthReturnUrlService } from '../../services/autentication/auth/auth-return-url.service';
import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';

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

  const subPath = segments?.[1]?.path ?? '';
  return !!subPath && allow.includes(subPath);
}

function decideGuestAccess$(
  attemptedUrl: string,
  allowAuthenticatedHere: boolean,
  redirectToParam: string | null
) {
  const router = inject(Router);
  const access = inject(AccessControlService);
  const returnUrl = inject(AuthReturnUrlService);
  const globalError = inject(GlobalErrorHandlerService);
  const notify = inject(ErrorNotificationService);

  return combineLatest([
    access.ready$,
    access.authUid$,
    access.appUser$,
    access.blockedReason$,
    access.emailVerified$,
  ]).pipe(
    /**
     * Só decide quando:
     * - auth ficou ready
     * - se NÃO há uid -> visitante, pode decidir já
     * - se HÁ uid -> espera o appUser hidratar e bater com o mesmo uid
     *
     * Isso elimina a race:
     * - uid antigo + appUser null após clear() não dispara redirect indevido
     */
    filter(([ready, authUid, appUser]) => {
      if (!ready) return false;

      if (!authUid) {
        return true;
      }

      if (appUser === undefined || appUser === null) {
        return false;
      }

      const appUid = (appUser as any)?.uid ?? null;
      return appUid === authUid;
    }),
    take(1),
    map(([_, authUid, appUser, blockedReason, emailVerified]): GuardResult => {
      // visitante -> pode entrar em /login e /register
      if (!authUid) {
        return true;
      }

      // rota explicitamente permitida para autenticado
      if (allowAuthenticatedHere) {
        return true;
      }

      const redirectTo = returnUrl.resolveAuthedRedirect(
        redirectToParam,
        '/dashboard/principal'
      );

      // bloqueio do app tem precedência
      if (blockedReason) {
        return router.createUrlTree(
          ['/register/welcome'],
          {
            queryParams: {
              reason: blockedReason,
              autocheck: '1',
              redirectTo,
            },
          }
        );
      }

      const profileCompleted = (appUser as any)?.profileCompleted === true;

      if (!profileCompleted) {
        return router.createUrlTree(
          ['/register/finalizar-cadastro'],
          { queryParams: { redirectTo } }
        );
      }

      if (!emailVerified) {
        return router.createUrlTree(
          ['/register/welcome'],
          {
            queryParams: {
              autocheck: '1',
              redirectTo,
            },
          }
        );
      }

      return router.parseUrl(redirectTo);
    }),
    catchError((err) => {
      try {
        (err as any).silent = true;
        (err as any).context = {
          guard: 'guest-only',
          attemptedUrl,
        };
        globalError.handleError(err);
      } catch {}

      notify.showError('Falha ao validar acesso.');
      return of(true);
    })
  );
}

export const guestOnlyCanActivate: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  return decideGuestAccess$(
    state.url,
    routeOrChildrenAllowAuthenticated(route),
    route.queryParamMap.get('redirectTo')
  );
};

export const guestOnlyCanMatch: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const attemptedUrl = '/' + (segments ?? []).map(s => s.path).filter(Boolean).join('/');

  return decideGuestAccess$(
    attemptedUrl,
    canMatchAllowsAuthenticated(route, segments),
    null
  );
}; // Linha 172, fim do guest-only.guard.ts
