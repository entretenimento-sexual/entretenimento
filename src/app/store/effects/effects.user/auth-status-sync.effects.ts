// src/app/store/effects/effects.user/auth-status-sync.effects.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';

import { EMPTY, of } from 'rxjs';
import {
  catchError,
  concatMap,
  filter,
  map,
  pairwise,
  startWith,
  take,
  tap,
} from 'rxjs/operators';

import { PresenceService } from 'src/app/core/services/presence/presence.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import {
  authSessionChanged,
  logoutSuccess,
} from '../../actions/actions.user/auth.actions';

import * as ChatActions from 'src/app/store/actions/actions.chat/chat.actions';
import { environment } from 'src/environments/environment';

@Injectable()
export class AuthStatusSyncEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly presence: PresenceService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  // ===========================================================================
  // Helpers (best-effort)
  // ===========================================================================

  /**
   * reportSilent()
   * - Centraliza o roteamento de erros para o GlobalErrorHandlerService.
   * - Mantém o effect “best-effort”: não quebra stream por erro.
   */
  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    try {
      if (!environment.production) {
        // eslint-disable-next-line no-console
        console.log('[AUTH][SYNC_EFFECT][ERROR]', context, err);
      }
      const e = err instanceof Error ? err : new Error('AuthStatusSyncEffects internal error');
      (e as any).silent = true;
      (e as any).context = context;
      (e as any).original = err;
      this.globalErrorHandler.handleError(e);
    } catch {
      // última linha de defesa: nunca quebrar a app por erro dentro do handler
    }
  }

  /**
   * stopPresenceBestEffort$()
   * - Usa Observable para padronizar e facilitar composição.
   * - Se PresenceService já for defensivo, isso vira “no-op” quando não ativo.
   */
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

  // ===========================================================================
  // Presence cleanup
  // ===========================================================================

  /**
   * ✅ Ao sair (logoutSuccess): parar presença (best-effort).
   * - Importante: escutar APENAS logoutSuccess evita duplicidade e ruído.
   */
  stopPresenceOnLogout$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(logoutSuccess),
        concatMap(() => this.stopPresenceBestEffort$())
      ),
    { dispatch: false }
  );

  /**
   * ✅ Sessão perdida/expirada (uid: algo -> null): parar presença também.
   * - Cobre “sessão morreu” sem ação explícita do usuário.
   */
  stopPresenceOnSessionLost$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(authSessionChanged),
        map(({ uid }) => uid ?? null),
        startWith(null),
        pairwise(),
        filter(([prevUid, currUid]) => !!prevUid && !currUid),
        concatMap(() => this.stopPresenceBestEffort$())
      ),
    { dispatch: false }
  );

  // ===========================================================================
  // Chat cleanup
  // ===========================================================================

  /**
   * ✅ Ao sair (logoutSuccess): encerra watchers + reseta estado do chat.
   * - Ordem importa:
   *   1) watchChatsStopped(): manda o “sinal” pros streams encerrarem
   *   2) resetChatState(): limpa store para evitar vazamento entre usuários
   */
  resetChatOnLogout$ = createEffect(() =>
    this.actions$.pipe(
      ofType(logoutSuccess),
      concatMap(() => {
        if (!environment.production) {
          // eslint-disable-next-line no-console
          console.log('[AUTH][SYNC_EFFECT] logoutSuccess -> stop chat watchers + reset chat state');
        }
        return of(
          ChatActions.watchChatsStopped(),
          ChatActions.resetChatState()
        );
      }),
      catchError((err) => {
        this.reportSilent(err, { phase: 'resetChatOnLogout$' });
        return EMPTY;
      })
    )
  );

  /**
   * ✅ Sessão perdida/expirada (uid: algo -> null): encerra watchers + reseta chat.
   * - Garante limpeza mesmo quando não houve logout explícito.
   */
  resetChatOnSessionLost$ = createEffect(() =>
    this.actions$.pipe(
      ofType(authSessionChanged),
      map(({ uid }) => uid ?? null),
      startWith(null),
      pairwise(),
      filter(([prevUid, currUid]) => !!prevUid && !currUid),
      concatMap(() => {
        if (!environment.production) {
          // eslint-disable-next-line no-console
          console.log('[AUTH][SYNC_EFFECT] session ended (uid -> null) -> stop chat watchers + reset chat state');
        }
        return of(
          ChatActions.watchChatsStopped(),
          ChatActions.resetChatState()
        );
      }),
      catchError((err) => {
        this.reportSilent(err, { phase: 'resetChatOnSessionLost$' });
        return EMPTY;
      })
    )
  );
} // Linha 169
