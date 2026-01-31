//src\app\core\guards\profile-guard\profile-completed.guard.ts
// Guard: bloqueia rotas que exigem perfil completo.
// - Verifica se o usuário está autenticado
// - Consulta o Firestore para checar profileCompleted
// - Em caso de erro, degrada para /register/finalizar-cadastro (não "prende" o usuário)
// Não esquerça de adicionar comentários explicativos.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { switchMap, take, map, catchError, of } from 'rxjs';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

export const profileCompletedGuard: CanActivateFn = (route, state) => {
  const allowIncomplete = route.data?.['allowProfileIncomplete'] === true;
  if (allowIncomplete) return of(true);

  const router = inject(Router);
  const currentUserStore = inject(CurrentUserStoreService);
  const userQuery = inject(FirestoreUserQueryService);
  const globalError = inject(GlobalErrorHandlerService);
  const notify = inject(ErrorNotificationService);

  return currentUserStore.getLoggedUserUID$().pipe(
    take(1),
    switchMap((uid) => {
      if (!uid) return of(buildRedirectTree(router, '/login', state.url));

      return userQuery.getUserOnce$(uid).pipe(
        take(1),
        map((user) => {
          const ok = user?.profileCompleted === true;
          guardLog('profile', 'uid:', uid, 'profileCompleted:', user?.profileCompleted);

          return ok
            ? true
            : buildRedirectTree(router, '/register/finalizar-cadastro', state.url, { reason: 'profile_incomplete' });
        })
      );
    }),
    catchError((err) => {
      // erro real: registra + feedback
      globalError.handleError(err);
      notify.showError('Erro ao validar seu perfil. Tente novamente.');
      return of(buildRedirectTree(router, '/register/finalizar-cadastro', state.url, { reason: 'profile_error' }));
    })
  );
};
