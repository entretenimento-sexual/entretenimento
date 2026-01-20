// src/app/store/effects/effects.interactions/friends/pagination.effects.ts
// Não esquecer comentários e ferramentas de debug
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { concatLatestFrom } from '@ngrx/operators';

import { of } from 'rxjs';
import { catchError, filter, map, switchMap } from 'rxjs/operators';

import * as P from '../../../actions/actions.interactions/friends/friends-pagination.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AppState } from 'src/app/store/states/app.state';
import {
  selectFriendsPageLoading,
  selectFriendsPageNextOrder,
  selectFriendsPageReachedEnd,
} from '../../../selectors/selectors.interactions/friends/pagination.selectors';

import { toEpoch } from 'src/app/store/utils/user-store.serializer';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable()
export class FriendsPaginationEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);
  private readonly svc = inject(FriendshipService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  /** normaliza cursor para Store: number | null (epoch) */
  private normalizeCursor(v: unknown): number | null {
    // aceita number | Timestamp | Date | null
    return toEpoch(v as any);
  }

  private report(err: unknown, context: Record<string, unknown>): void {
    try {
      const e = new Error('[FriendsPaginationEffects] listFriendsPage failed');
      (e as any).feature = 'friends-pagination';
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch { }
  }

  /** First + Refresh (replace) */
  loadFirstOrRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(P.loadFriendsFirstPage, P.refreshFriendsPage),

      // evita query com uid inválido
      filter(({ uid }) => !!(uid ?? '').trim()),

      switchMap(({ uid, pageSize }) =>
        this.svc.listFriendsPage(uid, pageSize ?? 24, null).pipe(
          map(({ items, nextAfter, reachedEnd }) =>
            P.loadFriendsPageSuccess({
              uid,
              items,
              // ✅ Store sempre epoch
              nextOrderValue: this.normalizeCursor(nextAfter),
              reachedEnd,
              append: false,
            })
          ),
          catchError((err) => {
            this.report(err, { step: 'first-or-refresh', uid, pageSize: pageSize ?? 24 });
            return of(P.loadFriendsPageFailure({ uid, error: String((err as any)?.message ?? err) }));
          })
        )
      )
    )
  );

  /** Next page (append) */
  loadNext$ = createEffect(() =>
    this.actions$.pipe(
      ofType(P.loadFriendsNextPage),

      // pega os 3 pedaços do store diretamente (sem reemitir action)
      concatLatestFrom((action) => [
        this.store.select(selectFriendsPageLoading(action.uid)),
        this.store.select(selectFriendsPageReachedEnd(action.uid)),
        this.store.select(selectFriendsPageNextOrder(action.uid)),
      ]),

      // se já está carregando ou já acabou, não faz nada
      filter(([action, loading, reachedEnd]) => {
        const uidOk = !!(action.uid ?? '').trim();
        return uidOk && !loading && !reachedEnd;
      }),

      switchMap(([action, _loading, _reachedEnd, nextOrderValue]) => {
        const afterEpoch = this.normalizeCursor(nextOrderValue); // ✅ number|null
        const size = action.pageSize ?? 24;

        return this.svc.listFriendsPage(action.uid, size, afterEpoch).pipe(
          map(({ items, nextAfter, reachedEnd }) =>
            P.loadFriendsPageSuccess({
              uid: action.uid,
              items,
              nextOrderValue: this.normalizeCursor(nextAfter),
              reachedEnd,
              append: true,
            })
          ),
          catchError((err) => {
            this.report(err, { step: 'next', uid: action.uid, pageSize: size, afterEpoch });
            return of(P.loadFriendsPageFailure({ uid: action.uid, error: String((err as any)?.message ?? err) }));
          })
        );
      })
    )
  );
}
