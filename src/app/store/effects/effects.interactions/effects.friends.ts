// src\app\store\effects\effects.interactions\effects.friends.ts
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Injectable } from '@angular/core';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { loadFriends, loadFriendsSuccess } from '../../actions/actions.interactions/actions.friends';
import { mergeMap, map, catchError, of } from 'rxjs';

@Injectable()
export class FriendsEffects {
  constructor(
    private actions$: Actions,
    private userInteractionsService: UserInteractionsService
  ) { }

  loadFriends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadFriends),
      mergeMap(({ uid }) =>
        this.userInteractionsService.listFriends(uid).pipe( // 🔄 Usa `listFriends()`
          map(friends => loadFriendsSuccess({ friends })),
          catchError(() => of(loadFriendsSuccess({ friends: [] })))
        )
      )
    )
  );
}
