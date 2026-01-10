//src\app\store\effects\effects.interactions\friends\requests-realtime.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, filter, map, switchMap, takeUntil } from 'rxjs/operators';
import * as A from '../../../actions/actions.interactions/actions.friends';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';

@Injectable()
export class FriendsRequestsRealtimeEffects {
  private actions$ = inject(Actions);
  private svc = inject(FriendshipService);

  listenInboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RT.startInboundRequestsListener),
      switchMap(({ uid }) =>
        this.svc.watchInboundRequests(uid).pipe(
          map(requests => RT.inboundRequestsChanged({ requests })),
          catchError(err => of(A.loadInboundRequestsFailure({ error: String(err?.message ?? err) }))),
          takeUntil(this.actions$.pipe(ofType(RT.stopInboundRequestsListener)))
        )
      )
    )
  );

  listenOutboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RT.startOutboundRequestsListener),
      switchMap(({ uid }) =>
        this.svc.watchOutboundRequests(uid).pipe(
          map(requests => RT.outboundRequestsChanged({ requests })),
          catchError(err => of(A.loadOutboundRequestsFailure({ error: String(err?.message ?? err) }))),
          takeUntil(this.actions$.pipe(ofType(RT.stopOutboundRequestsListener)))
        )
      )
    )
  );

  stopOnSessionNull$ = createEffect(() =>
    this.actions$.pipe(
      ofType(authSessionChanged),
      filter(({ uid }) => !uid),
      map(() => RT.stopInboundRequestsListener())
    )
  );
}
