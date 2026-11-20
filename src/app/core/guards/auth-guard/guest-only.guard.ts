// src/app/core/guards/auth-guard/guest-only.guard.ts
// -----------------------------------------------------------------------------
// GuestOnlyGuard
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - permitir rotas públicas para visitantes;
// - impedir que usuário autenticado volte para telas públicas comuns;
// - permitir etapas internas do fluxo de registro quando o usuário já está logado.
//
// Regra crítica desta versão:
//
// - /register/welcome:
//   rota autenticada de verificação/onboarding.
//
// - /register/recuperar-conta:
//   rota autenticada que recompõe users/{uid} quando o Auth existe sem perfil.
//
// - /register/aceitar-termos:
//   rota autenticada de aceite explícito antes da conclusão do perfil.
//
// - /register/finalizar-cadastro:
//   rota autenticada de conclusão do perfil.
//
// Separação:
// - emailVerified controla a confiança mínima da conta.
// - accountRecovery recompõe o documento privado ausente.
// - acceptedTerms controla o aceite legal explícito quando pendente.
// - profileCompleted controla a conclusão do perfil mínimo.

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
import { catchError, filter, map, take, timeout } from 'rxjs/operators';

import { AuthAppBlockService } from '../../services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { AuthReturnUrlService } from '../../services/autentication/auth/auth-return-url.service';
import { ApplicationErrorService } from '../../services/error-handler/application-error.service';
import { REGISTRATION_COMPLETION_ROUTE, resolveRegistrationReturnUrl } from 'src/app/register-module/data-access/register-flow.model';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';

import {
  AUTH_GUARD_WAIT_MS,
  AUTH_UNAVAILABLE_REASON,
  buildAuthRetryTree,
  buildFinalizeRedirectTree,
  buildRedirectTree,
  buildWelcomeRedirectTree,
  guardLog,
} from '../_shared-guard/guard-utils';

function routeOrChildrenAllowAuthenticated(route: ActivatedRouteSnapshot): boolean {
  if (route.data?.['allowAuthenticated'] === true) {
    return true;
  }

  for (const child of route.children ?? []) {
    if (routeOrChildrenAllowAuthenticated(child)) {
      return true;
    }
  }

  return false;
}

function canMatchAllowsAuthenticated(route: Route, segments: UrlSegment[]): boolean {
  const allow =
    (route.data?.['guestAllowAuthenticatedPaths'] as string[] | undefined) ?? [];

  if (!allow.length) {
    return false;
  }

  const subPath = segments?.[1]?.path ?? '';

  return !!subPath && allow.includes(subPath);
}

function cleanUrl(url: string): string {
  return (url ?? '').split('?')[0].split('#')[0];
}

function isRegisterWelcomePath(url: string): boolean {
  const clean = cleanUrl(url);

  return (
    clean === '/register/welcome' ||
    clean === '/register/verify'
  );
}

function isRegisterRecoveryPath(url: string): boolean {
  return cleanUrl(url) === '/register/recuperar-conta';
}

function isRegisterTermsPath(url: string): boolean {
  return cleanUrl(url) === '/register/aceitar-termos';
}

function isRegisterFinalizePath(url: string): boolean {
  return cleanUrl(url) === '/register/finalizar-cadastro';
}

function decideGuestAccess$(
  attemptedUrl: string,
  allowAuthenticatedHere: boolean,
  redirectToParam: string | null
) {
  const router = inject(Router);
  const access = inject(AccessControlService);
  const authSession = inject(AuthSessionService);
  const appBlock = inject(AuthAppBlockService);
  const returnUrl = inject(AuthReturnUrlService);
  const applicationError = inject(ApplicationErrorService);
  const notify = inject(ErrorNotificationService);

  const tryingLogin = cleanUrl(attemptedUrl) === '/login';
  const reason = router.parseUrl(attemptedUrl).queryParams['reason'];
  if (tryingLogin && reason === AUTH_UNAVAILABLE_REASON) return of(true);

  const tryingWelcome = isRegisterWelcomePath(attemptedUrl);
  const tryingRecovery = isRegisterRecoveryPath(attemptedUrl);
  const tryingTerms = isRegisterTermsPath(attemptedUrl);
  const tryingFinalize = isRegisterFinalizePath(attemptedUrl);

  return combineLatest([
    access.ready$,
    authSession.uid$,
    access.appUser$,
    access.blockedReason$,
    access.emailVerified$,
  ]).pipe(
    filter(([ready, authUid, appUser, blockedReason, emailVerified]) => {
      if (!ready) {
        return false;
      }

      if (!authUid) {
        return true;
      }

      return (tryingLogin && blockedReason === 'auth-invalid') ||
        (tryingWelcome && emailVerified === false &&
          authSession.currentAuthUser?.uid === authUid &&
          authSession.currentAuthUser?.emailVerified === false) ||
        (appUser !== undefined && (!appUser || appUser.uid === authUid));
    }),

    take(1),

    map(([_, authUid, appUser, blockedReason, emailVerified]): GuardResult => {
      const profileCompleted = (appUser as any)?.profileCompleted === true;
      const registrationReturnUrl = resolveRegistrationReturnUrl(redirectToParam);

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
        'emailVerified:', emailVerified,
        'tryingWelcome:', tryingWelcome,
        'tryingRecovery:', tryingRecovery,
        'tryingTerms:', tryingTerms,
        'tryingFinalize:', tryingFinalize,
        'redirectTo:', redirectTo
      );

      // -----------------------------------------------------------------------
      // VISITANTE
      // -----------------------------------------------------------------------
      if (!authUid) {
        if (tryingWelcome || tryingRecovery || tryingTerms || tryingFinalize) {
          return buildRedirectTree(router, '/login', redirectToParam ?? undefined, {
            retomarCadastro: '1',
            reason: authSession.currentAuthUser
              ? 'session-ended'
              : appBlock.invalidationSnapshot?.reason ?? 'session-ended',
          });
        }

        return true;
      }

      // -----------------------------------------------------------------------
      // AUTENTICADO
      // -----------------------------------------------------------------------

      if (blockedReason) {
        if (blockedReason === 'auth-invalid' && tryingLogin) return true;
        return tryingWelcome
          ? true
          : buildWelcomeRedirectTree(router, redirectTo, {
              reason: blockedReason,
            });
      }

      if (tryingWelcome) {
        return true;
      }

      if (emailVerified !== true) {
        return buildWelcomeRedirectTree(router, registrationReturnUrl ?? undefined, {
          reason: 'email_unverified',
        });
      }

      /**
       * Recuperação e termos antecedem a regra de perfil incompleto.
       * O registrationStepGuard confirma se cada rota é a etapa canônica atual.
       */
      if (tryingRecovery || tryingTerms) {
        return true;
      }

      if (tryingFinalize) {
        if (!profileCompleted) {
          return true;
        }

        return router.parseUrl(registrationReturnUrl ?? REGISTRATION_COMPLETION_ROUTE);
      }

      if (!profileCompleted) {
        return buildFinalizeRedirectTree(router, registrationReturnUrl ?? undefined, {
          reason: 'profile_incomplete',
        });
      }

      if (allowAuthenticatedHere) {
        return true;
      }

      return router.parseUrl(redirectTo);
    }),

    timeout({ first: AUTH_GUARD_WAIT_MS, with: () => of(buildAuthRetryTree(router, attemptedUrl)) }),
    catchError((err) => {
      try {
        applicationError.report(err, {
          feature: 'auth-guard',
          operation: 'guestOnly',
          fallbackMessage: 'Falha ao validar acesso.',
          presentation: { surface: 'none', severity: 'error' },
          metadata: { scope: 'guestOnlyGuard' },
        });
      } catch {
        // Guard continua fail-safe mesmo se o diagnóstico falhar.
      }

      notify.showError('Falha ao validar acesso.');

      return of(buildAuthRetryTree(router, attemptedUrl));
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

export const guestOnlyCanMatch: CanMatchFn = (
  route: Route,
  segments: UrlSegment[]
) => {
  const attemptedUrl =
    '/' + (segments ?? []).map((segment) => segment.path).filter(Boolean).join('/');

  const router = inject(Router);
  const navigation = router.currentNavigation();
  const initialUrl = navigation && router.serializeUrl(navigation.extractedUrl);
  const url = initialUrl && cleanUrl(initialUrl) === attemptedUrl ? initialUrl : attemptedUrl;
  return decideGuestAccess$(
    url,
    canMatchAllowsAuthenticated(route, segments),
    router.parseUrl(url).queryParamMap.get('redirectTo')
  );
};
