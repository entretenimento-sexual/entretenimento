import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot, CanActivateFn, CanMatchFn, GuardResult, Route, Router, UrlSegment,
} from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { catchError, filter, map, switchMap, take, timeout } from 'rxjs/operators';

import { AuthAppBlockService } from '../../services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '../../services/error-handler/application-error.service';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';
import { isRegistrationStepRoute, resolveRegistrationReturnUrl } from 'src/app/register-module/data-access/register-flow.model';

import {
  AUTH_GUARD_WAIT_MS, AUTH_UNAVAILABLE_REASON, buildAuthRetryTree, buildRedirectTree,
} from '../_shared-guard/guard-utils';

function routeOrChildrenAllowAuthenticated(route: ActivatedRouteSnapshot): boolean {
  return route.data?.['allowAuthenticated'] === true ||
    route.children.some(routeOrChildrenAllowAuthenticated);
}

function cleanUrl(url: string): string {
  return url.split(/[?#]/, 1)[0];
}

function decideGuestAccess$(attemptedUrl: string, allowAuthenticated: boolean, redirectTo: string | null) {
  const router = inject(Router);
  const access = inject(AccessControlService);
  const session = inject(AuthSessionService);
  const appBlock = inject(AuthAppBlockService);
  const errors = inject(ApplicationErrorService);

  const path = cleanUrl(attemptedUrl);
  const tryingLogin = path === '/login';
  const registrationStep = isRegistrationStepRoute(path) || path === '/register/verify';
  if (tryingLogin && router.parseUrl(attemptedUrl).queryParams['reason'] === AUTH_UNAVAILABLE_REASON) return of(true);

  const navigation = inject(PostAuthNavigationService);
  return combineLatest([access.ready$, session.uid$, access.blockedReason$]).pipe(
    filter(([ready, uid]) => ready && (session.currentAuthUser?.uid ?? null) === uid),
    take(1),
    timeout({ first: AUTH_GUARD_WAIT_MS, with: () => of(null) }),
    switchMap((state) => {
      if (!state) return of<GuardResult>(buildAuthRetryTree(router, attemptedUrl));
      const [, uid, blockedReason] = state;
      const safeRedirect = resolveRegistrationReturnUrl(redirectTo);
      if (!uid) {
        return of<GuardResult>(registrationStep && path !== '/register/verify'
          ? buildRedirectTree(router, '/login', safeRedirect ?? undefined, {
            retomarCadastro: '1',
            reason: appBlock.invalidationSnapshot?.reason,
          })
          : true);
      }

      if (blockedReason === 'auth-invalid') {
        return of<GuardResult>(tryingLogin
          ? true
          : buildRedirectTree(router, '/login', safeRedirect ?? undefined, { reason: appBlock.invalidationSnapshot?.reason }));
      }

      const domainBlock = appBlock.domainBlockFor(uid);
      if (domainBlock) {
        return of<GuardResult>(buildRedirectTree(router, '/conta/status', safeRedirect ?? undefined, { reason: domainBlock }));
      }

      // As etapas autenticadas validam o mesmo estado através de registrationStepGuard.
      if (registrationStep || allowAuthenticated) return of<GuardResult>(true);

      return navigation.resolveForCurrentSession$(uid, safeRedirect).pipe(map((target) => router.parseUrl(target)));
    }),
    catchError((error: unknown) => {
      if ((error as { code?: string } | null)?.code !== 'auth/session-changed') {
        try {
          errors.report(error, {
            feature: 'auth-guard',
            operation: 'guestOnly',
            fallbackMessage: 'Não foi possível consultar a próxima etapa.',
            presentation: { surface: 'none', severity: 'warning' },
          });
        } catch {
          // A tentativa continua disponível mesmo se o diagnóstico falhar.
        }
      }
      return of(buildAuthRetryTree(router, attemptedUrl));
    })
  );
}

export const guestOnlyCanActivate: CanActivateFn = (route, state) =>
  decideGuestAccess$(state.url, routeOrChildrenAllowAuthenticated(route), route.queryParamMap.get('redirectTo'));

export const guestOnlyCanMatch: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const attemptedPath = '/' + segments.map((segment) => segment.path).filter(Boolean).join('/');
  const router = inject(Router);
  const navigation = router.currentNavigation();
  const initialUrl = navigation && router.serializeUrl(navigation.extractedUrl);
  const url = initialUrl && cleanUrl(initialUrl) === attemptedPath ? initialUrl : attemptedPath;
  const allowed = (route.data?.['guestAllowAuthenticatedPaths'] as string[] | undefined) ?? [];
  return decideGuestAccess$(url, allowed.includes(segments[1]?.path ?? ''), router.parseUrl(url).queryParamMap.get('redirectTo'));
};
