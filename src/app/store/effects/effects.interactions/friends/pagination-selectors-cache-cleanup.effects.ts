// src/app/store/effects/effects.interactions/friends/pagination-selectors-cache-cleanup.effects.ts
// Limpa caches de selectors quando a sessão encerra (logout / uid null).
// - dispatch:false (efeito “side-effect only”)
// - Mantém meta-reducers puros.
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
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

  clearOnLogout$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(Auth.logoutSuccess),
        tap(() => {
          clearFriendsPaginationSelectorsCache();
          this.dbg('cache cleared on logoutSuccess', __friendsPaginationSelectorsDebug.cacheSizes());
        })
      ),
    { dispatch: false }
  );

  clearOnSessionNull$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(Auth.authSessionChanged),
        tap(({ uid }) => {
          if (uid !== null) return;
          clearFriendsPaginationSelectorsCache();
          this.dbg('cache cleared on authSessionChanged(uid:null)', __friendsPaginationSelectorsDebug.cacheSizes());
        })
      ),
    { dispatch: false }
  );
}
