// src/app/store/effects/effects.user/auth-status-sync.effects.ts
// Sincroniza efeitos globais de lifecycle da autenticação.
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';

import { of } from 'rxjs';
import {
  catchError,
  concatMap,
  filter,
  map,
  pairwise,
  startWith,
  take,
} from 'rxjs/operators';

import { PresenceService } from 'src/app/core/services/presence/presence.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

import {
  authSessionChanged,
  logoutSuccess,
} from '../../actions/actions.user/auth.actions';

@Injectable()
export class AuthStatusSyncEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly presence: PresenceService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('auth', `AuthStatusSyncEffects: ${message}`, extra);
  }

  /**
   * Mantém o effect best-effort e envia falhas ao handler centralizado.
   */
  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    try {
      this.dbg('reportSilent()', { context, error: err });
      const error =
        err instanceof Error
          ? err
          : new Error('AuthStatusSyncEffects internal error');

      (error as any).silent = true;
      (error as any).context = context;
      (error as any).original = err;
      this.globalErrorHandler.handleError(error);
    } catch {
      // Falha de telemetria não interrompe o lifecycle da sessão.
    }
  }

  private stopPresenceBestEffort$() {
    return this.presence.stop$().pipe(
      take(1),
      catchError((err) => {
        this.reportSilent(err, { phase: 'stopPresenceBestEffort$' });
        return of(void 0);
      }),
      map(() => void 0)
    );
  }

  /** Para presença no logout explícito. */
  stopPresenceOnLogout$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(logoutSuccess),
        concatMap(() => this.stopPresenceBestEffort$())
      ),
    { dispatch: false }
  );

  /** Para presença quando a sessão é perdida sem logout explícito. */
  stopPresenceOnSessionLost$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(authSessionChanged),
        map(({ uid }) => uid ?? null),
        startWith(null),
        pairwise(),
        filter(([previousUid, currentUid]) => !!previousUid && !currentUid),
        concatMap(() => this.stopPresenceBestEffort$())
      ),
    { dispatch: false }
  );
}
