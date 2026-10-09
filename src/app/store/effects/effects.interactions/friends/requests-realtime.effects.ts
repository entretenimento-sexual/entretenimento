//src\app\store\effects\effects.interactions\friends\requests-realtime.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, filter, map, switchMap, takeUntil, withLatestFrom } from 'rxjs/operators';
import * as A from '../../../actions/actions.interactions/actions.friends';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';

@Injectable()
export class FriendsRequestsRealtimeEffects {
  private actions$ = inject(Actions);
  private svc = inject(FriendshipService);
  private access = inject(AccessControlService);

  listenFriends$ = createEffect(() =>
  this.actions$.pipe(
    ofType(RT.startFriendsListener),
    withLatestFrom(this.access.authUid$),
    filter(([{ uid }, currentUid]) => uid === currentUid),
    switchMap(([{ uid }]) =>
      this.svc.watchFriends(uid).pipe(
        map(friends => RT.friendsChanged({ friends })),
        catchError(err => of(A.loadFriendsFailure({ error: String(err?.message ?? err) }))),
        takeUntil(this.actions$.pipe(ofType(RT.stopFriendsListener))),
        takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== uid)))
      )
    )
  )
);

  listenInboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RT.startInboundRequestsListener),
    withLatestFrom(this.access.authUid$),
    filter(([{ uid }, currentUid]) => uid === currentUid),
    switchMap(([{ uid }]) =>
        this.svc.watchInboundRequests(uid).pipe(
          map(requests => RT.inboundRequestsChanged({ requests })),
          catchError(err => of(A.loadInboundRequestsFailure({ error: String(err?.message ?? err) }))),
          takeUntil(this.actions$.pipe(ofType(RT.stopInboundRequestsListener))),
        takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== uid)))
        )
      )
    )
  );

  listenOutboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RT.startOutboundRequestsListener),
    withLatestFrom(this.access.authUid$),
    filter(([{ uid }, currentUid]) => uid === currentUid),
    switchMap(([{ uid }]) =>
        this.svc.watchOutboundRequests(uid).pipe(
          map(requests => RT.outboundRequestsChanged({ requests })),
          catchError(err => of(A.loadOutboundRequestsFailure({ error: String(err?.message ?? err) }))),
          takeUntil(this.actions$.pipe(ofType(RT.stopOutboundRequestsListener))),
        takeUntil(this.access.authUid$.pipe(filter(currentUid => currentUid !== uid)))
        )
      )
    )
  );

stopOnSessionNull$ = createEffect(() =>
  this.actions$.pipe(
    ofType(authSessionChanged),
    filter(({ uid }) => !uid),
    switchMap(() => of(
      RT.stopFriendsListener(),
      RT.stopInboundRequestsListener(),
      RT.stopOutboundRequestsListener(),
    ))
  )
);
}
