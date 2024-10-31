// src/app/store/effects/effects.chat/invite.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { InviteService } from 'src/app/core/services/batepapo/invite.service';
import * as InviteActions from '../../actions/actions.chat/invite.actions';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { from, of } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { selectUserState } from '../../selectors/selectors.user/user.selectors';

@Injectable()
export class InviteEffects {
  constructor(
    private actions$: Actions,
    private inviteService: InviteService,
    private store: Store<AppState>
  ) { }

  loadInvites$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.LoadInvites),
      mergeMap(() =>
        this.store.select(selectUserState).pipe(
          mergeMap(userState => {
            const userId = userState?.currentUser?.uid; // Alterado de `id` para `uid`
            if (!userId) {
              console.error('Erro: userId não encontrado.');
              return of(InviteActions.LoadInvitesFailure({ error: 'Usuário não autenticado' }));
            }
            console.log('Carregando convites para userId:', userId);
            return this.inviteService.getInvites(userId).pipe(
              map(invites => {
                console.log('Convites carregados com sucesso:', invites);
                return InviteActions.LoadInvitesSuccess({ invites });
              }),
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

  acceptInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.AcceptInvite),
      mergeMap(action => {
        console.log('Aceitando convite com ID:', action.inviteId);
        return from(this.inviteService.acceptInvite(action.inviteId)).pipe(
          map(() => {
            console.log('Convite aceito com sucesso para ID:', action.inviteId);
            return InviteActions.AcceptInviteSuccess({ inviteId: action.inviteId });
          }),
          catchError(error => {
            console.error('Erro ao aceitar convite:', error);
            return of(InviteActions.AcceptInviteFailure({ error }));
          })
        );
      })
    )
  );

  declineInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.DeclineInvite),
      mergeMap(action => {
        console.log('Recusando convite com ID:', action.inviteId);
        return from(this.inviteService.declineInvite(action.inviteId)).pipe(
          map(() => {
            console.log('Convite recusado com sucesso para ID:', action.inviteId);
            return InviteActions.DeclineInviteSuccess({ inviteId: action.inviteId });
          }),
          catchError(error => {
            console.error('Erro ao recusar convite:', error);
            return of(InviteActions.DeclineInviteFailure({ error }));
          })
        );
      })
    )
  );
}
