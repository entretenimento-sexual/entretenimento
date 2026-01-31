// Guard: bloqueia rotas que exigem e-mail verificado.
// - Respeita route.data.allowUnverified (ex.: /perfil do próprio usuário, onboarding, etc.)
// - Espera o Firebase restaurar sessão (authStateReady) para evitar decisões prematuras
// - Em caso de erro, degrada para /register/welcome (não "prende" o usuário)
// src/app/core/guards/profile-guard/email-verified.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

export const emailVerifiedGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const authSession = inject(AuthSessionService);
  const globalError = inject(GlobalErrorHandlerService);
  const notify = inject(ErrorNotificationService);

  // ✅ respeita allowUnverified (ex.: telas “leves”/onboarding)
  const allowUnverified = route.data?.['allowUnverified'] === true;
  if (allowUnverified) return of(true);

  return authSession.ready$.pipe(
    take(1),
    switchMap(() => authSession.authUser$.pipe(take(1))),
    map((u) => {
      if (!u?.uid) return buildRedirectTree(router, '/login', state.url);

      const ok = u.emailVerified === true;
      guardLog('email', 'uid:', u.uid, 'auth.emailVerified:', u.emailVerified);

      return ok
        ? true
        : buildRedirectTree(router, '/register/welcome', state.url, {
          reason: 'email_unverified',
          autocheck: 1,
        });
    }),
    catchError((err) => {
      globalError.handleError(err);
      notify.showError('Erro ao validar verificação de e-mail. Tente novamente.');
      return of(
        buildRedirectTree(router, '/register/welcome', state.url, {
          reason: 'email_error',
          autocheck: 1,
        })
      );
    })
  );
};
