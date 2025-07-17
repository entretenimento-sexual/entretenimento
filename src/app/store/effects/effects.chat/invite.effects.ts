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
import { environment } from '../../../../environments/environment';

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
      switchMap(() =>
        this.store.select(selectUserState).pipe(
          map(userState => userState?.currentUser?.uid),
          switchMap(userId => {
            if (!userId) {
              if (!environment.production) {
                console.log('[InviteEffects] Erro: usuário não autenticado.');
              }
              return of(InviteActions.LoadInvitesFailure({ error: 'Usuário não autenticado.' }));
            }
            if (!environment.production) {
              console.log('[InviteEffects] Carregando convites para o usuário:', userId);
            }
            return this.inviteService.getInvites(userId).pipe(
              map(invites => InviteActions.LoadInvitesSuccess({ invites })),
              catchError(error => {
                if (!environment.production) {
                  console.log('[InviteEffects] Erro ao carregar convites:', error);
                }
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
      mergeMap((action) => {
        if (!environment.production) {
          console.log('[InviteEffects] Aceitando convite:', action.inviteId);
        }
        return this.inviteService.updateInviteStatus(action.roomId, action.inviteId, 'accepted').pipe(
          map(() => InviteActions.AcceptInviteSuccess({ inviteId: action.inviteId })),
          catchError((error) => {
            if (!environment.production) {
              console.log('[InviteEffects] Erro ao aceitar convite:', error);
            }
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
        if (!environment.production) {
          console.log('[InviteEffects] Recusando convite:', action.inviteId);
        }
        return this.inviteService.updateInviteStatus(action.roomId, action.inviteId, 'declined').pipe(
          map(() => InviteActions.DeclineInviteSuccess({ inviteId: action.inviteId })),
          catchError((error) => {
            if (!environment.production) {
              console.log('[InviteEffects] Erro ao recusar convite:', error);
            }
            return of(InviteActions.DeclineInviteFailure({ error }));
          })
        );
      })
    )
  );
}
