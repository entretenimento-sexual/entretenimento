// src\app\store\effects\effects.interactions\effects.friends.ts
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Injectable } from '@angular/core';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { loadFriends, loadFriendsSuccess, sendFriendRequest, sendFriendRequestSuccess, sendFriendRequestFailure, loadFriendsFailure } from '../../actions/actions.interactions/actions.friends';
import { mergeMap, map, catchError, of, switchMap } from 'rxjs';
import { IFriend } from 'src/app/core/interfaces/friendship/ifriend';

@Injectable()
export class FriendsEffects {
  constructor(private actions$: Actions,
              private userInteractionsService: UserInteractionsService) { }

  // ✅ Efeito para carregar amigos
  loadFriends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadFriends),
      mergeMap(({ uid }) =>
        this.userInteractionsService.listFriends(uid).pipe(
          map(friends =>
            loadFriendsSuccess({
              friends: friends.map(friend => ({
                friendUid: friend.friendUid,
                friendSince: new Date(friend.friendSince) // ✅ Define data corretamente
              }) as IFriend)
            })
          ),
          catchError(error => of(loadFriendsFailure({ error: error.message })))
        )
      )
    )
  );

  // ✅ Efeito para enviar solicitação de amizade
  sendFriendRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(sendFriendRequest),
      switchMap(({ userUid, friendUid }) =>
        this.userInteractionsService.sendFriendRequest(userUid, friendUid).pipe(
          map(() => sendFriendRequestSuccess({ friend: { friendUid: friendUid, friendSince: new Date() } as IFriend })), // ✅ Conversão correta
          catchError(error => of(sendFriendRequestFailure({ error: error.message })))
        )
      )
    )
  );
}
