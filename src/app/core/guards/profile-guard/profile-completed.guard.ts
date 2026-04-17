// src/app/core/guards/profile-guard/profile-completed.guard.ts
// Guard: bloqueia rotas que exigem perfil completo.
//
// AJUSTES DESTA VERSÃO:
// - mantém o bypass por route.data.allowProfileIncomplete
// - adiciona bypass explícito para o fluxo de fotos
// - evita que upload/galeria briguem com o onboarding
//
// OBSERVAÇÃO:
// - isso é um ajuste funcional concreto.
// - depois, se quiser, você pode migrar esse bypass para data nas rotas
//   e remover a detecção por URL.

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

function isPhotosFlowUrl(url: string): boolean {
  const clean = (url ?? '').split('?')[0];

  return (
    /^\/perfil\/[^/]+\/fotos(?:\/upload)?$/i.test(clean) ||
    /^\/media\/perfil\/[^/]+\/fotos(?:\/upload)?$/i.test(clean) ||
    clean === '/media/photos'
  );
}

export const profileCompletedGuard: CanActivateFn = (route, state) => {
  const allowIncompleteByData = route.data?.['allowProfileIncomplete'] === true;
  const allowIncompleteByPhotosFlow = isPhotosFlowUrl(state.url);

  if (allowIncompleteByData || allowIncompleteByPhotosFlow) {
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