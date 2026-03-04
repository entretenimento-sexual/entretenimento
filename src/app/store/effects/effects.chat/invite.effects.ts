// src/app/store/effects/effects.chat/invite.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import * as InviteActions from '../../actions/actions.chat/invite.actions';
import { map, switchMap, catchError, mergeMap } from 'rxjs/operators';
import { of } from 'rxjs';

import { InviteInboxService } from '@core/services/batepapo/invite-service/invite-inbox.service';
import { RoomInviteFlowService } from '@core/services/batepapo/room-services/room-invite-flow.service';

@Injectable()
export class InviteEffects {
  constructor(
    private actions$: Actions,
    private inbox: InviteInboxService,
    private roomInviteFlow: RoomInviteFlowService
  ) { }

  // ✅ Realtime inbox
  loadInvites$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.LoadInvites),
      switchMap(({ userId }) =>
        this.inbox.observeMyPendingInvitesSafe(userId).pipe(
          map(invites => InviteActions.LoadInvitesSuccess({ invites })),
          catchError(err =>
            of(InviteActions.LoadInvitesFailure({ error: String(err?.message ?? err) }))
          )
        )
      )
    )
  );

  // ✅ Aceitar convite de SALA via transação
  acceptInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.AcceptInvite),
      mergeMap(({ inviteId }) =>
        this.roomInviteFlow.acceptRoomInvite$(inviteId).pipe(
          map(() => InviteActions.AcceptInviteSuccess({ inviteId })),
          catchError(err =>
            of(InviteActions.AcceptInviteFailure({ error: String(err?.message ?? err) }))
          )
        )
      )
    )
  );

  // ✅ Recusar convite de SALA via transação
  declineInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.DeclineInvite),
      mergeMap(({ inviteId }) =>
        this.roomInviteFlow.declineRoomInvite$(inviteId).pipe(
          map(() => InviteActions.DeclineInviteSuccess({ inviteId })),
          catchError(err =>
            of(InviteActions.DeclineInviteFailure({ error: String(err?.message ?? err) }))
          )
        )
      )
    )
  );
}
