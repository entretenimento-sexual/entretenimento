// src/app/store/effects/effects.user/auth-status-sync.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';

import { PresenceService } from 'src/app/core/services/presence/presence.service';
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
