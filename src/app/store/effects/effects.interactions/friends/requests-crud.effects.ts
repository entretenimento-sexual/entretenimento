//src\app\store\effects\effects.interactions\friends\requests-crud.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { catchError, concatMap, filter, map, mergeMap, switchMap, withLatestFrom, exhaustMap } from 'rxjs/operators';
import * as A from '../../../actions/actions.interactions/actions.friends';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable()
export class FriendsRequestsCrudEffects {
  private actions$ = inject(Actions);
  private store = inject(Store<AppState>);
  private svc = inject(FriendshipService);
  private notifier = inject(ErrorNotificationService);

  sendFriendRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.sendFriendRequest),
      exhaustMap(({ requesterUid, targetUid, message }) =>
        this.svc.sendRequest(requesterUid, targetUid, message).pipe(
          map(() => A.sendFriendRequestSuccess()),
          catchError(err => {
            const msg = String(err?.message ?? 'Falha ao enviar solicitação.');
            this.notifier.showError(msg);
            return of(A.sendFriendRequestFailure({ error: msg }));
          })
        )
      )
    )
  );

  loadOutboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadOutboundRequests),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listOutboundRequests(uid).pipe(
          map(requests => A.loadOutboundRequestsSuccess({ requests })),
          catchError(err => of(A.loadOutboundRequestsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  refreshOutboundAfterSend$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.sendFriendRequestSuccess),
      withLatestFrom(this.store.select(selectCurrentUserUid)),
      filter(([, uid]) => !!uid),
      map(([, uid]) => A.loadOutboundRequests({ uid: uid! }))
    )
  );

  cancelOutbound$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.cancelFriendRequest),
      switchMap(({ requestId }) =>
        this.svc.cancelOutboundRequest(requestId).pipe(
          map(() => A.cancelFriendRequestSuccess({ requestId })),
          catchError(err => of(A.cancelFriendRequestFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  refreshOutboundAfterSendOrCancel$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.sendFriendRequestSuccess, A.cancelFriendRequestSuccess),
      withLatestFrom(this.store.select(selectCurrentUserUid)),
      filter(([, uid]) => !!uid),
      map(([, uid]) => A.loadOutboundRequests({ uid: uid! }))
    )
  );


  loadInboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadInboundRequests),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listInboundRequests(uid).pipe(
          map(requests => A.loadInboundRequestsSuccess({ requests })),
          catchError(err => of(A.loadInboundRequestsFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

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

  afterAcceptOrDeclineRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.acceptFriendRequestSuccess, A.declineFriendRequestSuccess),
      withLatestFrom(this.store.select(selectCurrentUserUid)),
      filter(([, uid]) => !!uid),
      mergeMap(([, uid]) => of(
        A.loadInboundRequests({ uid: uid! }),
        A.loadFriends({ uid: uid! })
      ))
    )
  );
}
