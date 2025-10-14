// src/app/store/effects/effects.chat/invite.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import * as InviteActions from '../../actions/actions.chat/invite.actions';
import { map, mergeMap, catchError, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { InviteService } from 'src/app/core/services/batepapo/invite-service/invite.service';

@Injectable()
export class InviteEffects {
  constructor(
    private actions$: Actions,
    private inviteService: InviteService,
  ) { }

  loadInvites$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.LoadInvites),
      switchMap(({ userId }) =>
        this.inviteService.getInvites(userId).pipe(
          map(invites => InviteActions.LoadInvitesSuccess({ invites })),
          catchError(err => of(InviteActions.LoadInvitesFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  acceptInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.AcceptInvite),
      mergeMap(({ inviteId }) =>
        this.inviteService.updateInviteStatus(inviteId, 'accepted').pipe(
          map(() => InviteActions.AcceptInviteSuccess({ inviteId })),
          catchError(err => of(InviteActions.AcceptInviteFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );

  declineInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.DeclineInvite),
      mergeMap(({ inviteId }) =>
        this.inviteService.updateInviteStatus(inviteId, 'declined').pipe(
          map(() => InviteActions.DeclineInviteSuccess({ inviteId })),
          catchError(err => of(InviteActions.DeclineInviteFailure({ error: String(err?.message ?? err) })))
        )
      )
    )
  );
}
