// src/app/store/effects/effects.chat/invite.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import * as InviteActions from '../../actions/actions.chat/invite.actions';
import { map, mergeMap, catchError, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { selectUserState } from '../../selectors/selectors.user/user.selectors';
import { InviteService } from 'src/app/core/services/batepapo/invite-service/invite.service';

@Injectable()
export class InviteEffects {
  constructor(
    private actions$: Actions,
    private inviteService: InviteService,
    private store: Store<AppState>
  ) { }

  // Efeito para carregar convites
  loadInvites$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.LoadInvites), // Ouve a ação LoadInvites
      switchMap(() =>
        this.store.select(selectUserState).pipe(
          map(userState => userState?.currentUser?.uid), // Extrai o UID do usuário
          switchMap(userId => {
            if (!userId) {
              console.error('Erro: usuário não autenticado.');
              return of(InviteActions.LoadInvitesFailure({ error: 'Usuário não autenticado.' }));
            }

            // Busca os convites do usuário
            return this.inviteService.getInvites(userId).pipe(
              map(invites => InviteActions.LoadInvitesSuccess({ invites })),
              catchError(error => {
                console.error('Erro ao carregar convites:', error);
                return of(InviteActions.LoadInvitesFailure({ error }));
              })
            );
          })
        )
      )
    )
  );

  // Efeito para aceitar convites
  acceptInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.AcceptInvite),
      mergeMap((action) =>
        this.inviteService
          .updateInviteStatus(action.roomId, action.inviteId, 'accepted')
          .pipe(
            map(() => InviteActions.AcceptInviteSuccess({ inviteId: action.inviteId })),
            catchError((error) => {
              console.error('Erro ao aceitar convite:', error);
              return of(InviteActions.AcceptInviteFailure({ error }));
            })
          )
      )
    )
  );

  // Efeito para recusar convites
  declineInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.DeclineInvite),
      mergeMap(action =>
        this.inviteService.updateInviteStatus(action.roomId, action.inviteId, 'declined').pipe(
          map(() => InviteActions.DeclineInviteSuccess({ inviteId: action.inviteId })),
          catchError((error) => {
            console.error('Erro ao recusar convite:', error);
            return of(InviteActions.DeclineInviteFailure({ error }));
          })
        )
      )
    )
  );
}
