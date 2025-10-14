// src/app/store/effects/effects.interactions/effects.friends.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import * as A from '../../actions/actions.interactions/actions.friends';
import { FriendshipService } from 'src/app/core/services/interactions/friendship.service';
import { catchError, concatMap, exhaustMap, filter, map, mergeMap, of, switchMap } from 'rxjs';
import { Store } from '@ngrx/store';
import { selectCurrentUserUid } from '../../selectors/selectors.user/user.selectors'; // ⬅️ selecione o UID atual
import { distinctUntilChanged, tap } from 'rxjs/operators';
import { AppState } from '../../states/app.state';
import { environment } from 'src/environments/environment';

@Injectable()
export class FriendsEffects {
  constructor(
    private actions$: Actions,
    private svc: FriendshipService,
    private store: Store<AppState>
  ) { }

  private dbg(msg: string, extra?: unknown) {
    if (!environment.production) console.log('[FRIENDS_EFFECTS]', msg, extra ?? '');
  }

  /** Quando o usuário loga é definido no Store, puxe amigos e inbound pendentes */
  bootstrapOnUser$ = createEffect(() =>
    this.store.select(selectCurrentUserUid).pipe(
      filter((uid): uid is string => !!uid),
      distinctUntilChanged(),
      tap(uid => this.dbg('bootstrapOnUser$ -> uid mudou', uid)),
      concatMap((uid) => [
        A.loadFriends({ uid }),
        A.loadInboundRequests({ uid }),
        A.loadBlockedUsers({ uid }),
      ])
    )
  );

  // Friends list
  loadFriends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadFriends),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listFriends(uid).pipe(
          tap(f => console.log('[FRIENDS_EFFECTS] loadFriends →', f.length)),
          map(friends => A.loadFriendsSuccess({ friends })),
          catchError(err => of(A.loadFriendsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  // Send request (use exhaustMap para evitar duplo clique)
  sendRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.sendFriendRequest),
      exhaustMap(({ requesterUid, targetUid, message }) =>
        this.svc.sendRequest(requesterUid, targetUid, message).pipe(
          map(() => A.sendFriendRequestSuccess()),
          catchError(err => of(A.sendFriendRequestFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  // Inbound requests
  loadInboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadInboundRequests),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listInboundRequests(uid).pipe(
          tap(reqs => console.log('[FRIENDS_EFFECTS] loadInboundRequests →', reqs.length)),
          map(requests => A.loadInboundRequestsSuccess({ requests })),
          catchError(err => of(A.loadInboundRequestsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  // Accept (concatMap para garantir ordem)
  acceptRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.acceptFriendRequest),
      concatMap(({ requestId, requesterUid, targetUid }) =>
        this.svc.acceptRequest(requestId, requesterUid, targetUid).pipe(
          map(() => A.acceptFriendRequestSuccess({ requestId })),
          catchError(err => of(A.acceptFriendRequestFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  // Decline
  declineRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.declineFriendRequest),
      concatMap(({ requestId }) =>
        this.svc.declineRequest(requestId).pipe(
          map(() => A.declineFriendRequestSuccess({ requestId })),
          catchError(err => of(A.declineFriendRequestFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  // Block / Unblock (mantém a lista coerente)
  blockUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.blockUser),
      mergeMap(({ ownerUid, targetUid, reason }) =>
        this.svc.blockUser(ownerUid, targetUid, reason).pipe(
          map(() => A.loadBlockedUsers({ uid: ownerUid })),
          catchError(err => of(A.loadFriendsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  unblockUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.unblockUser),
      mergeMap(({ ownerUid, targetUid }) =>
        this.svc.unblockUser(ownerUid, targetUid).pipe(
          map(() => A.loadBlockedUsers({ uid: ownerUid })),
          catchError(err => of(A.loadFriendsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  loadBlocked$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadBlockedUsers),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listBlocked(uid).pipe(
          map(blocked => A.loadBlockedUsersSuccess({ blocked })),
          catchError(err => of(A.loadFriendsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );
}
