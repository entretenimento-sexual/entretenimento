//src\app\store\effects\effects.interactions\friends\network.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import * as A from '../../../actions/actions.interactions/actions.friends';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { catchError, filter, map, mergeMap, switchMap, distinctUntilChanged } from 'rxjs/operators';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';

@Injectable()
export class FriendsNetworkEffects {
  constructor(
    private actions$: Actions,
    private svc: FriendshipService,
    private store: Store<AppState>,
  ) { }

  bootstrapOnUser$ = createEffect(() =>
    this.store.select(selectCurrentUserUid).pipe(
      filter((uid): uid is string => !!uid),
      distinctUntilChanged(),
      switchMap(uid =>
        of(
          A.loadFriends({ uid }),
          A.loadInboundRequests({ uid }),
          A.loadOutboundRequests({ uid }),
          A.loadBlockedUsers({ uid }),
          RT.startInboundRequestsListener({ uid }),
          RT.startOutboundRequestsListener({ uid }),
        )
      )
    )
  );

  loadFriends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadFriends),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listFriends(uid).pipe(
          map(friends => A.loadFriendsSuccess({ friends })),
          catchError(err => of(A.loadFriendsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  blockUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.blockUser),
      mergeMap(({ ownerUid, targetUid, reason }) =>
        this.svc.blockUser(ownerUid, targetUid, reason).pipe(
          mergeMap(() => of(
            A.blockUserSuccess({ ownerUid, targetUid }),
            A.loadBlockedUsers({ uid: ownerUid })
          )),
          catchError(err => of(A.blockUserFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  unblockUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.unblockUser),
      mergeMap(({ ownerUid, targetUid }) =>
        this.svc.unblockUser(ownerUid, targetUid).pipe(
          mergeMap(() => of(
            A.unblockUserSuccess({ ownerUid, targetUid }),
            A.loadBlockedUsers({ uid: ownerUid })
          )),
          catchError(err => of(A.unblockUserFailure({ error: String(err?.message ?? err) })))
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
          catchError(err => of(A.loadBlockedUsersFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );
}
