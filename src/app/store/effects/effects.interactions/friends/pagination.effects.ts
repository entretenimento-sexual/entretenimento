// src/app/store/effects/effects.interactions/friends/pagination.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of, EMPTY } from 'rxjs';
import { catchError, map, switchMap, withLatestFrom } from 'rxjs/operators';
import * as P from '../../../actions/actions.interactions/friends/friends-pagination.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AppState } from 'src/app/store/states/app.state';
import {
  selectFriendsPageLoading,
  selectFriendsPageNextOrder,
  selectFriendsPageReachedEnd,
} from '../../../selectors/selectors.interactions/friends/pagination.selectors';

// helper: normaliza cursor (number | Timestamp | null) => number | null
function toAfterNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  return Number(v) || null;
}

@Injectable()
export class FriendsPaginationEffects {
  private actions$ = inject(Actions);
  private store = inject<Store<AppState>>(Store as any);
  private svc = inject(FriendshipService);

  /** First + Refresh (replace) */
  loadFirstOrRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(P.loadFriendsFirstPage, P.refreshFriendsPage),
      switchMap(({ uid, pageSize }) =>
        this.svc.listFriendsPage(uid, pageSize ?? 24, null).pipe(
          map(({ items, nextAfter, reachedEnd }) =>
            P.loadFriendsPageSuccess({
              uid,
              items,
              nextOrderValue: nextAfter ?? null,
              reachedEnd,
              append: false, // replace
            })
          ),
          catchError((err) =>
            of(P.loadFriendsPageFailure({ uid, error: String(err?.message ?? err) }))
          )
        )
      )
    )
  );

  /** Next page (append) */
  loadNext$ = createEffect(() =>
    this.actions$.pipe(
      ofType(P.loadFriendsNextPage),
      // pega do store a situação atual desse UID
      withLatestFrom(
        this.actions$.pipe(ofType(P.loadFriendsNextPage)), // reemite a ação para acessar uid/pageSize
      ),
      // ^ truque pra manter acesso ao action nas próximas etapas sem perder o tipo
      switchMap(([_, action]) =>
        this.store.select(selectFriendsPageLoading(action.uid)).pipe(
          withLatestFrom(
            this.store.select(selectFriendsPageReachedEnd(action.uid)),
            this.store.select(selectFriendsPageNextOrder(action.uid))
          ),
          switchMap(([loading, reachedEnd, nextOrderValue]) => {
            if (loading || reachedEnd) return EMPTY;

            const after = toAfterNumber(nextOrderValue);
            const size = action.pageSize ?? 24;

            return this.svc.listFriendsPage(action.uid, size, after).pipe(
              map(({ items, nextAfter, reachedEnd }) =>
                P.loadFriendsPageSuccess({
                  uid: action.uid,
                  items,
                  nextOrderValue: nextAfter ?? null,
                  reachedEnd,
                  append: true, // append
                })
              ),
              catchError((err) =>
                of(P.loadFriendsPageFailure({ uid: action.uid, error: String(err?.message ?? err) }))
              )
            );
          })
        )
      )
    )
  );
}
