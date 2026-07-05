// src/app/core/guards/auth-guard/auth-redirect.guard.ts
// -----------------------------------------------------------------------------
// AuthRedirectGuard
// -----------------------------------------------------------------------------
//
// Guard de redirecionamento para rotas de visitante.
//
// Regra corrigida:
// - e-mail não verificado tem prioridade sobre conclusão de perfil;
// - completar perfil depende de e-mail verificado;
// - verificar e-mail não significa perfil completo.

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { AuthReturnUrlService } from '../../services/autentication/auth/auth-return-url.service';
import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';

import {
  buildFinalizeRedirectTree,
  buildWelcomeRedirectTree,
  guardLog,
  isResolvedAccessState,
} from '../_shared-guard/guard-utils';

export const authRedirectGuard: CanActivateFn = (route, _state) => {
  const router = inject(Router);
  const access = inject(AccessControlService);
  const returnUrl = inject(AuthReturnUrlService);
  const globalError = inject(GlobalErrorHandlerService);
  const notify = inject(ErrorNotificationService);

  const allowAuthenticated = route.data?.['allowAuthenticated'] === true;

  if (allowAuthenticated) {
    return of(true);
  }

  const redirectToParam = route.queryParamMap.get('redirectTo');

  return combineLatest([
    access.ready$,
    access.authUid$,
    access.appUser$,
    access.blockedReason$,
    access.emailVerified$,
  ]).pipe(
    filter(([ready, authUid, appUser]) => {
      return ready === true && isResolvedAccessState(authUid, appUser);
    }),

    take(1),

    map(([_, authUid, appUser, blockedReason, emailVerified]) => {
      if (!authUid) {
        guardLog('auth-redirect', 'guest -> allow');
        return true;
      }

      const redirectTo = returnUrl.resolveAuthedRedirect(
        redirectToParam,
        '/dashboard/principal'
      );

      const profileCompleted = (appUser as any)?.profileCompleted === true;

      guardLog('auth-redirect', 'authed -> redirect decision', {
        uid: authUid,
        emailVerified,
        profileCompleted,
        blockedReason,
        redirectTo,
      });

      /**
       * 1) Conta bloqueada/interrompida.
       */
      if (blockedReason) {
        return buildWelcomeRedirectTree(router, redirectTo, {
          reason: blockedReason,
        });
      }

      /**
       * 2) E-mail não verificado vem antes da conclusão do perfil.
       *
       * O destino correto para usuário autenticado sem e-mail verificado
       * é /register/welcome, não /register/finalizar-cadastro.
       */
      if (!emailVerified) {
        return buildWelcomeRedirectTree(router, redirectTo, {
          reason: 'email_unverified',
        });
      }

      /**
       * 3) Perfil incompleto, com e-mail já verificado,
       * deve ir para finalizar cadastro.
       */
      if (!profileCompleted) {
        return buildFinalizeRedirectTree(router, redirectTo, {
          reason: 'profile_incomplete',
        });
      }

      /**
       * 4) Conta liberada.
       */
      return router.parseUrl(redirectTo);
    }),

    catchError((err) => {
      try {
        (err as any).silent = true;
        (err as any).context = {
          guard: 'authRedirectGuard',
        };

        globalError.handleError(err);
      } catch {
        // noop
      }

      notify.showError('Falha ao validar redirecionamento.');

      return of(true);
    })
  );
};
