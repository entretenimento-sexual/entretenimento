// src/app/core/guards/profile-guard/email-verified.guard.ts
// Guard: bloqueia rotas que exigem e-mail verificado.
//
// Estratégia desta versão:
// - respeita route.data.allowUnverified === true
// - exige sessão autenticada
// - usa AccessControlService como fonte principal
// - usa Auth.currentUser.emailVerified como fallback defensivo
// - em dev-emu, permite bypass explícito APENAS para preferências,
//   quando a navegação vier do WelcomeComponent com state controlado
// - em erro, degrada para /register/welcome

import { inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { environment } from 'src/environments/environment';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  buildRedirectTree,
  buildWelcomeRedirectTree,
  guardLog,
  isResolvedAccessState,
} from '../_shared-guard/guard-utils';

export const emailVerifiedGuard: CanActivateFn = (route, state) => {
  const allowUnverified = route.data?.['allowUnverified'] === true;
  if (allowUnverified) {
    return of(true);
  }

  const router = inject(Router);
  const auth = inject(Auth);
  const access = inject(AccessControlService);
  const globalError = inject(GlobalErrorHandlerService);
  const notify = inject(ErrorNotificationService);

  return combineLatest([
    access.ready$,
    access.authUid$,
    access.appUser$,
    access.emailVerified$,
  ]).pipe(
    filter(([ready, authUid, appUser]) => {
      return ready === true && isResolvedAccessState(authUid, appUser);
    }),
    take(1),

    map(([_, authUid, __, emailVerified]) => {
      if (!authUid) {
        return buildRedirectTree(router, '/login', state.url);
      }

      /**
       * BYPASS EXPLÍCITO APENAS EM DEV-EMU E APENAS PARA /preferencias
       * acionado pela navegação do WelcomeComponent.
       */
      const nav = router.getCurrentNavigation();
      const devBypassEmailVerified =
        !environment.production &&
        environment.env === 'dev-emu' &&
        /^\/preferencias(\/|$)/.test(state.url) &&
        nav?.extras?.state?.['devBypassEmailVerified'] === true;

      if (devBypassEmailVerified) {
        guardLog(
          'email',
          'DEV BYPASS ativo',
          'uid:',
          authUid,
          'url:',
          state.url
        );
        return true;
      }

      const currentAuthUser = auth.currentUser;
      const authFallbackVerified =
        currentAuthUser?.uid === authUid &&
        currentAuthUser?.emailVerified === true;

      guardLog(
        'email',
        'uid:',
        authUid,
        'emailVerified(access):',
        emailVerified,
        'emailVerified(authFallback):',
        authFallbackVerified,
        'url:',
        state.url
      );

      if (emailVerified === true || authFallbackVerified === true) {
        return true;
      }

      return buildWelcomeRedirectTree(router, state.url, {
        reason: 'email_unverified',
      });
    }),

    catchError((err) => {
      globalError.handleError(err);
      notify.showError('Erro ao validar verificação de e-mail. Tente novamente.');

      return of(
        buildWelcomeRedirectTree(router, state.url, {
          reason: 'email_error',
        })
      );
    })
  );
};