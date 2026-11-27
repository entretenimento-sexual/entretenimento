// src/app/store/effects/effects.interactions/friends/pagination.effects.ts
// Efeitos de paginação da lista de amigos
// - loadFirstOrRefresh: observa a primeira página canônica (replace)
// - loadNext: carrega a próxima página (append)
// - debug fica atrás de flag local para não poluir console nem expor diagnóstico em fluxo normal
import { Injectable, inject, isDevMode } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { concatLatestFrom } from '@ngrx/operators';

import { of } from 'rxjs';
import { catchError, filter, map, switchMap, exhaustMap, tap, takeUntil } from 'rxjs/operators';

import * as P from '../../../actions/actions.interactions/friends/friends-pagination.actions';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AppState } from 'src/app/store/states/app.state';
import {
  selectFriendsPageNextOrder,
  selectFriendsPageReachedEnd,
} from '../../../selectors/selectors.interactions/friends/pagination.selectors';

import type { FriendsPageCursor } from 'src/app/core/interfaces/friendship/friend.interface';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable()
export class FriendsPaginationEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);
  private readonly svc = inject(FriendshipService);
  private readonly session = inject(AuthSessionService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  private readonly debugEnabled =
    isDevMode() &&
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('debug.friends-pagination') === '1';

  private debug(label: string, data?: Record<string, unknown>): void {
    if (!this.debugEnabled) return;
    // eslint-disable-next-line no-console
    console.debug(`[FriendsPaginationEffects] ${label}`, data ?? {});
  }

  /** Não converter o cursor em epoch: preserva a ordem total e a precisão. */
  private normalizeCursor(v: FriendsPageCursor | null | undefined): FriendsPageCursor | null {
    return v ?? null;
  }

  private report(err: unknown, context: Record<string, unknown>): void {
    try {
      const e = new Error('[FriendsPaginationEffects] listFriendsPage failed');
      (e as any).feature = 'friends-pagination';
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch { /* noop */ }
  }

  /** Primeira página viva + refresh explícito; mesmo listener da sessão. */
  loadFirstOrRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(P.loadFriendsFirstPage, P.refreshFriendsPage),
      filter(({ uid }) => !!(uid ?? '').trim()),
      tap(({ uid, pageSize }) => this.debug('first-or-refresh:action', { uid, pageSize })),
      concatLatestFrom(() => this.session.authUser$),
      filter(([action, user]) => !!user && user.uid === action.uid),
      switchMap(([{ uid, pageSize }, user]) => {
        const size = pageSize ?? 24;

        return this.svc.watchFriendsPage(uid, size).pipe(
          takeUntil(this.session.authUser$.pipe(filter(current => current !== user))),
          takeUntil(this.actions$.pipe(ofType(P.resetFriendsPagination), filter(event => event.uid === uid))),
          tap(({ items, nextAfter, reachedEnd }) =>
            this.debug('first-or-refresh:svc:ok', {
              uid,
              size,
              items: items?.length ?? 0,
              hasNextCursor: nextAfter !== null,
              reachedEnd,
            })
          ),
          map(({ items, nextAfter, reachedEnd }) =>
            P.loadFriendsPageSuccess({
              uid,
              items,
              nextOrderValue: this.normalizeCursor(nextAfter),
              reachedEnd,
              append: false,
            })
          ),
          catchError((err) => {
            this.report(err, { step: 'first-or-refresh', uid, pageSize: size });
            this.debug('first-or-refresh:svc:error', { uid, size, err: String((err as any)?.message ?? err) });
            return of(P.loadFriendsPageFailure({ uid, error: String((err as any)?.message ?? err), replace: true }));
          })
        );
      })
    )
  );

  /** Next page (append) */
  loadNext$ = createEffect(() =>
    this.actions$.pipe(
      ofType(P.loadFriendsNextPage),
      tap(({ uid, pageSize }) => this.debug('next:action', { uid, pageSize })),
      concatLatestFrom((action) => [
        this.store.select(selectFriendsPageReachedEnd(action.uid)),
        this.store.select(selectFriendsPageNextOrder(action.uid)),
        this.session.authUser$,
      ]),
      filter(([action, reachedEnd, cursor, user]) => {
        const uidOk = !!(action.uid ?? '').trim();
        // Effects observe actions after reducers set loading=true. A valid
        // cursor plus exhaustMap, not that flag, admits the next page.
        const canRun = uidOk && user?.uid === action.uid && !reachedEnd && cursor !== null;

        if (!canRun) {
          this.debug('next:skipped', { uid: action.uid, reachedEnd, hasCursor: cursor !== null });
        }

        return canRun;
      }),
      exhaustMap(([action, _reachedEnd, nextOrderValue, user]) => {
        const after = this.normalizeCursor(nextOrderValue);
        const size = action.pageSize ?? 24;

        this.debug('next:svc:call', { uid: action.uid, size, after });

        return this.svc.listFriendsPage(action.uid, size, after).pipe(
          takeUntil(this.session.authUser$.pipe(filter(current => current !== user))),
          takeUntil(this.actions$.pipe(
            ofType(P.loadFriendsFirstPage, P.refreshFriendsPage, P.resetFriendsPagination),
            filter(event => event.uid === action.uid)
          )),
          takeUntil(this.actions$.pipe(
            ofType(P.removeFriendFromFriendsPage),
            filter(event => event.uid === action.uid)
          )),
          // Um novo snapshot da primeira página invalida a geração do cursor.
          takeUntil(this.actions$.pipe(
            ofType(P.loadFriendsPageSuccess),
            filter(event => event.uid === action.uid && !event.append)
          )),
          takeUntil(this.actions$.pipe(
            ofType(P.loadFriendsPageFailure),
            filter(event => event.uid === action.uid && event.replace === true)
          )),
          tap(({ items, nextAfter, reachedEnd }) =>
            this.debug('next:svc:ok', {
              uid: action.uid,
              size,
              items: items?.length ?? 0,
              hasNextCursor: nextAfter !== null,
              reachedEnd,
            })
          ),
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
            this.report(err, { step: 'next', uid: action.uid, pageSize: size, after });
            this.debug('next:svc:error', { uid: action.uid, size, after, err: String((err as any)?.message ?? err) });
            return of(P.loadFriendsPageFailure({ uid: action.uid, error: String((err as any)?.message ?? err) }));
          })
        );
      })
    )
  );
}
