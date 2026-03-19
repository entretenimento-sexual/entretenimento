// src/app/core/guards/auth-guard/guest-only.guard.ts
import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  CanMatchFn,
  GuardResult,
  Route,
  Router,
  RouterStateSnapshot,
  UrlSegment,
} from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { AuthReturnUrlService } from '../../services/autentication/auth/auth-return-url.service';
import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';
import {
  buildFinalizeRedirectTree,
  buildRedirectTree,
  buildWelcomeRedirectTree,
  guardLog,
} from '../_shared-guard/guard-utils';

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

function isRegisterWelcomePath(url: string): boolean {
  const clean = url.split('?')[0];
  return clean === '/register/welcome' || clean === '/register/verify';
}

function isRegisterFinalizePath(url: string): boolean {
  return url.split('?')[0] === '/register/finalizar-cadastro';
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

  const tryingWelcome = isRegisterWelcomePath(attemptedUrl);
  const tryingFinalize = isRegisterFinalizePath(attemptedUrl);

  return combineLatest([
    access.ready$,
    access.authUid$,
    access.appUser$,
    access.blockedReason$,
    access.emailVerified$,
  ]).pipe(
    filter(([ready, authUid, appUser]) => {
      if (!ready) return false;

      // visitante: pode decidir já
      if (!authUid) return true;

      // autenticado: espera hidratar
      return appUser !== undefined;
    }),
    take(1),
    map(([_, authUid, appUser, blockedReason, emailVerified]): GuardResult => {
      const profileCompleted = (appUser as any)?.profileCompleted === true;
      const redirectTo = returnUrl.resolveAuthedRedirect(
        redirectToParam,
        '/dashboard/principal'
      );

      guardLog(
        'guest',
        'attemptedUrl:', attemptedUrl,
        'uid:', authUid,
        'allowAuthenticatedHere:', allowAuthenticatedHere,
        'blockedReason:', blockedReason,
        'profileCompleted:', profileCompleted,
        'emailVerified:', emailVerified
      );

      // -----------------------------------------------------------------------
      // VISITANTE
      // -----------------------------------------------------------------------
      if (!authUid) {
        if (tryingWelcome || tryingFinalize) {
          return buildRedirectTree(router, '/register');
        }

        return true;
      }

      // -----------------------------------------------------------------------
      // AUTENTICADO
      // -----------------------------------------------------------------------

      // 1) bloqueio do app -> welcome
      if (blockedReason) {
        return tryingWelcome
          ? true
          : buildWelcomeRedirectTree(router, redirectTo, { reason: blockedReason });
      }

      // 2) e-mail não verificado -> welcome
      if (emailVerified !== true) {
        return tryingWelcome
          ? true
          : buildWelcomeRedirectTree(router, redirectTo, {
              reason: 'email_unverified',
            });
      }

      // 3) perfil incompleto -> finalizar-cadastro
      if (!profileCompleted) {
        return tryingFinalize
          ? true
          : buildFinalizeRedirectTree(router, redirectTo, {
              reason: 'profile_incomplete',
            });
      }

      // 4) autenticado, completo e verificado
      if (allowAuthenticatedHere) {
        return true;
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
      return of(buildRedirectTree(router, '/login', attemptedUrl, { reason: 'guest_guard_error' }));
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
};
