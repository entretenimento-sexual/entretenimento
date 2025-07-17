// src\app\store\effects\effects.interactions\effects.friends.ts
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Injectable } from '@angular/core';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { loadFriends, loadFriendsSuccess, sendFriendRequest, sendFriendRequestSuccess, sendFriendRequestFailure, loadFriendsFailure } from '../../actions/actions.interactions/actions.friends';
import { mergeMap, map, catchError, of, switchMap } from 'rxjs';
import { IFriend } from 'src/app/core/interfaces/friendship/ifriend';
import { environment } from '../../../../environments/environment';

@Injectable()
export class FriendsEffects {
  constructor(private actions$: Actions,
    private userInteractionsService: UserInteractionsService) { }

  loadFriends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadFriends),
      mergeMap(({ uid }) => {
        if (!environment.production) {
          console.log('[FriendsEffects] loadFriends acionado para UID:', uid);
        }
        return this.userInteractionsService.listFriends(uid).pipe(
          map(friends => {
            const mappedFriends = friends.map(friend => ({
              friendUid: friend.friendUid,
              friendSince: new Date(friend.friendSince)
            }) as IFriend);
            if (!environment.production) {
              console.log('[FriendsEffects] loadFriendsSuccess com amigos:', mappedFriends);
            }
            return loadFriendsSuccess({ friends: mappedFriends });
          }),
          catchError(error => {
            if (!environment.production) {
              console.log('[FriendsEffects] Erro ao carregar amigos:', error);
            }
            return of(loadFriendsFailure({ error: error.message }));
          })
        );
      })
    )
  );

  sendFriendRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(sendFriendRequest),
      switchMap(({ userUid, friendUid }) => {
        if (!environment.production) {
          console.log('[FriendsEffects] Enviando solicitação de amizade de', userUid, 'para', friendUid);
        }
        return this.userInteractionsService.sendFriendRequest(userUid, friendUid).pipe(
          map(() => {
            const newFriend: IFriend = { friendUid: friendUid, friendSince: new Date() };
            if (!environment.production) {
              console.log('[FriendsEffects] sendFriendRequestSuccess com amigo:', newFriend);
            }
            return sendFriendRequestSuccess({ friend: newFriend });
          }),
          catchError(error => {
            if (!environment.production) {
              console.log('[FriendsEffects] Erro ao enviar solicitação de amizade:', error);
            }
            return of(sendFriendRequestFailure({ error: error.message }));
          })
        );
      })
    )
  );
}
