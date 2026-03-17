// src/app/core/guards/profile-guard/profile-completed.guard.ts
// Guard: bloqueia rotas que exigem perfil completo.
//
// Regras:
// - respeita route.data.allowProfileIncomplete === true
// - exige sessão autenticada
// - usa appUser já hidratado pelo fluxo canônico do projeto
// - em erro, degrada para /register/finalizar-cadastro
//
// Observação:
// - evita nova query no Firestore dentro do guard
// - reduz race condition e duplicação de responsabilidade
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  buildFinalizeRedirectTree,
  buildRedirectTree,
  guardLog,
  isResolvedAccessState,
} from '../_shared-guard/guard-utils';

export const profileCompletedGuard: CanActivateFn = (route, state) => {
  const allowIncomplete = route.data?.['allowProfileIncomplete'] === true;
  if (allowIncomplete) {
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
  ]).pipe(
    filter(([ready, authUid, appUser]) => {
      return ready === true && isResolvedAccessState(authUid, appUser);
    }),
    take(1),

    map(([_, authUid, appUser]) => {
      if (!authUid) {
        return buildRedirectTree(router, '/login', state.url);
      }

      const profileCompleted = (appUser as any)?.profileCompleted === true;

      guardLog(
        'profile',
        'uid:',
        authUid,
        'profileCompleted:',
        profileCompleted,
        'url:',
        state.url
      );

      return profileCompleted
        ? true
        : buildFinalizeRedirectTree(router, state.url, {
            reason: 'profile_incomplete',
          });
    }),

    catchError((err) => {
      globalError.handleError(err);
      notify.showError('Erro ao validar seu perfil. Tente novamente.');
      return of(
        buildFinalizeRedirectTree(router, state.url, {
          reason: 'profile_error',
        })
      );
    })
  );
};
