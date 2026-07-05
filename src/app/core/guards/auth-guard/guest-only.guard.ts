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
//   Pode ser acessada por usuário autenticado mesmo com profileCompleted=false.
//
// - /register/finalizar-cadastro:
//   rota autenticada de conclusão do perfil.
//   Só deve ser liberada para usuário autenticado depois de emailVerified=true.
//
// Separação:
// - emailVerified controla a confiança mínima da conta.
// - profileCompleted controla a conclusão do perfil mínimo.
// - e-mail não verificado bloqueia finalizar cadastro e redireciona para welcome.

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

  /**
   * Em /register/finalizar-cadastro:
   * segments tende a vir como ['register', 'finalizar-cadastro'].
   */
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
      if (!ready) {
        return false;
      }

      /**
       * Visitante:
       * não precisa esperar appUser.
       */
      if (!authUid) {
        return true;
      }

      /**
       * Autenticado:
       * espera hidratar users/{uid} antes de decidir profileCompleted.
       */
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
        'emailVerified:', emailVerified,
        'tryingWelcome:', tryingWelcome,
        'tryingFinalize:', tryingFinalize,
        'redirectTo:', redirectTo
      );

      // -----------------------------------------------------------------------
      // VISITANTE
      // -----------------------------------------------------------------------
      if (!authUid) {
        /**
         * Visitante não entra em etapas autenticadas do registro.
         */
        if (tryingWelcome || tryingFinalize) {
          return buildRedirectTree(router, '/register');
        }

        return true;
      }

      // -----------------------------------------------------------------------
      // AUTENTICADO
      // -----------------------------------------------------------------------

      /**
       * 1) Conta bloqueada/interrompida.
       *
       * Mantém welcome como tela segura para explicar bloqueio/estado.
       */
      if (blockedReason) {
        return tryingWelcome
          ? true
          : buildWelcomeRedirectTree(router, redirectTo, {
              reason: blockedReason,
            });
      }

      /**
       * 2) Welcome é rota válida do fluxo autenticado.
       *
       * Não redirecionamos daqui só porque profileCompleted=false.
       * O usuário pode estar verificando e-mail ou vendo feedback pós-link.
       */
      if (tryingWelcome) {
        return true;
      }

      /**
       * 3) E-mail não verificado tem prioridade sobre finalização do perfil.
       *
       * Alinha este guard com RegisterNavigationService:
       * conta criada -> verificação de e-mail -> conclusão do perfil.
       */
      if (emailVerified !== true) {
        return buildWelcomeRedirectTree(router, redirectTo, {
          reason: 'email_unverified',
        });
      }

      /**
       * 4) Finalizar cadastro é rota válida para perfil incompleto
       * somente depois da verificação do e-mail.
       */
      if (tryingFinalize) {
        if (!profileCompleted) {
          return true;
        }

        /**
         * Se o perfil já está completo, não faz sentido permanecer
         * na tela de finalização.
         */
        return router.parseUrl(redirectTo);
      }

      /**
       * 5) Perfil incompleto, com e-mail já verificado,
       * deve ir para a conclusão de cadastro.
       */
      if (!profileCompleted) {
        return buildFinalizeRedirectTree(router, redirectTo, {
          reason: 'profile_incomplete',
        });
      }

      /**
       * 6) Algumas rotas guest internas aceitam usuário autenticado
       * por decisão explícita.
       */
      if (allowAuthenticatedHere) {
        return true;
      }

      /**
       * 7) Usuário autenticado, perfil completo e e-mail verificado:
       * sai de rotas guest e vai ao destino final.
       */
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
      } catch {
        // noop
      }

      notify.showError('Falha ao validar acesso.');

      return of(
        buildRedirectTree(router, '/login', attemptedUrl, {
          reason: 'guest_guard_error',
        })
      );
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

  return decideGuestAccess$(
    attemptedUrl,
    canMatchAllowsAuthenticated(route, segments),
    null
  );
};
