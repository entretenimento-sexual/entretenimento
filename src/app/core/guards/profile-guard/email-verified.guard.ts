// src/app/core/guards/profile-guard/email-verified.guard.ts
// Guard: bloqueia rotas que exigem e-mail verificado.
//
// Regras:
// - respeita route.data.allowUnverified === true
// - exige sessão autenticada
// - usa AccessControlService como fonte consolidada
// - em erro, degrada para /register/welcome
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

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

      guardLog('email', 'uid:', authUid, 'emailVerified:', emailVerified, 'url:', state.url);

      return emailVerified === true
        ? true
        : buildWelcomeRedirectTree(router, state.url, {
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
