// src/app/store/effects/effects.interactions/friends/pagination-selectors-cache-cleanup.effects.ts
// Limpa caches de selectors sempre que a identidade operacional muda.
// - dispatch:false (efeito “side-effect only”)
// - Mantém meta-reducers puros.
// - authSessionChanged é a única autoridade de sessão no Store.
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { distinctUntilChanged, map, tap } from 'rxjs/operators';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

import * as Auth from 'src/app/store/actions/actions.user/auth.actions';
import {
  clearFriendsPaginationSelectorsCache,
  __friendsPaginationSelectorsDebug,
} from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';

@Injectable()
export class FriendsPaginationSelectorsCacheCleanupEffects {
  private readonly actions$ = inject(Actions);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log(
      'friends',
      `FriendsSelectorsCleanup: ${message}`,
      extra
    );
  }

  /**
   * SUPRESSÃO EXPLÍCITA:
   * - removido o antigo listener de `logoutSuccess`.
   *
   * Motivo:
   * - `logoutSuccess` não é mais uma autoridade válida de sessão;
   * - o cache precisa ser limpo também em troca direta de UID, não apenas logout;
   * - `authSessionChanged` cobre logout, hard signout, expiração e troca de conta.
   */
  clearOnSessionChange$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(Auth.authSessionChanged),
        map(({ uid }) => uid ?? null),
        distinctUntilChanged(),
        tap((uid) => {
          clearFriendsPaginationSelectorsCache();
          this.dbg(
            'cache cleared on authSessionChanged',
            {
              uid,
              ...__friendsPaginationSelectorsDebug.cacheSizes(),
            }
          );
        })
      ),
    { dispatch: false }
  );
}
