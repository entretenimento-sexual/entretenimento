// src/app/store/effects/effects.interactions/effects.friends.ts
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Injectable } from '@angular/core';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import * as FriendsActions from '../../actions/actions.interactions/actions.friends';
import { catchError, map, mergeMap, of, exhaustMap, tap } from 'rxjs';
import { IFriend } from 'src/app/core/interfaces/friendship/ifriend';
import { environment } from '../../../../environments/environment';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable()
export class FriendsEffects {
  constructor(
    private actions$: Actions,
    private userInteractionsService: UserInteractionsService,
    private errorNotifier: ErrorNotificationService
  ) { }

  /** Carregar amigos */
  loadFriends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(FriendsActions.loadFriends),
      mergeMap(({ uid }) => {
        if (!environment.production) {
          console.log('[FriendsEffects] loadFriends →', uid);
        }
        return this.userInteractionsService.listFriends(uid).pipe(
          map(friends => FriendsActions.loadFriendsSuccess({ friends })),
          catchError(err =>
            of(
              FriendsActions.loadFriendsFailure({
                error: err?.message ?? String(err ?? 'Erro desconhecido'),
              })
            )
          )
        );
      })
    )
  );

  /**
   * Enviar solicitação de amizade
   * - usamos `exhaustMap` para evitar “duplo clique” disparando solicitações em paralelo
   */
  sendFriendRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(FriendsActions.sendFriendRequest),
      exhaustMap(({ userUid, friendUid, message }) => {
        if (!environment.production) {
          console.log('[FriendsEffects] sendFriendRequest →', { userUid, friendUid, message });
        }
        return this.userInteractionsService.sendFriendRequest(userUid, friendUid, message).pipe(
          // sucesso não adiciona à lista de friends — só sinaliza sucesso
          map(() =>
            FriendsActions.sendFriendRequestSuccess({
              // payload é mantido por compatibilidade; o reducer ignora
              friend: { friendUid, friendSince: new Date() } as IFriend,
            })
          ),
          catchError(err =>
            of(
              FriendsActions.sendFriendRequestFailure({
                error: err?.message ?? 'Falha ao enviar solicitação.',
              })
            )
          )
        );
      })
    )
  );

  /** Notificação de erro (side effect sem dispatch) */
  notifySendFriendRequestFailure$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(FriendsActions.sendFriendRequestFailure),
        tap(({ error }) => this.errorNotifier.showError('Erro ao enviar solicitação.', error))
      ),
    { dispatch: false }
  );

  /** Notificação de sucesso (side effect sem dispatch) */
  notifySendFriendRequestSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(FriendsActions.sendFriendRequestSuccess),
        tap(() => this.errorNotifier.showSuccess('Solicitação enviada!'))
      ),
    { dispatch: false }
  );
}
