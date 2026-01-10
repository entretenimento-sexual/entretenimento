// src/app/store/effects/effects.user/auth-status-sync.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';

import { PresenceService } from 'src/app/core/services/autentication/auth/presence.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { authSessionChanged, loginSuccess, logout, logoutSuccess } from '../../actions/actions.user/auth.actions';

@Injectable()
export class AuthStatusSyncEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly presence: PresenceService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  /**
   * ✅ Após login: inicia o PresenceService.
   * Importante: NgRx NÃO atualiza isOnline no state aqui.
   * A fonte da verdade é o Firestore via PresenceService + queries.
   */
  startPresenceAfterLogin$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(loginSuccess),
        tap(({ user }) => {
          try {
            if (user?.uid) this.presence.start(user.uid);
          } catch (err) {
            // Presença não deve quebrar login/UX — apenas reporta no handler global.
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error('Falha ao iniciar PresenceService.')
            );
          }
        })
      ),
    { dispatch: false }
  );

  startStopPresenceOnSession$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(authSessionChanged),
        tap(({ uid }) => {
          try {
            if (uid) this.presence.start(uid);
            else this.presence.stop();
          } catch (err) {
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error('Falha ao sincronizar PresenceService.')
            );
          }
        })
      ),
    { dispatch: false }
  );

  /**
   * ✅ Ao sair: para o PresenceService (best-effort).
   * Observação: o PresenceService também tem mecanismos de offline em eventos de saída/visibilidade.
   */
  stopPresenceOnLogout$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(logout, logoutSuccess),
        tap(() => {
          try {
            this.presence.stop();
          } catch (err) {
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error('Falha ao parar PresenceService.')
            );
          }
        })
      ),
    { dispatch: false }
  );
}
