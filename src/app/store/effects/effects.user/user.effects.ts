//src\app\store\effects\effects.user\user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  observeUserChanges, loadUsers, loadUsersSuccess, loadUsersFailure } from '../../actions/actions.user/user.actions';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { catchError, map, switchMap, of } from 'rxjs';
import { Store, select } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { selectUserById } from '../../selectors/selectors.user/user.selectors';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { sanitizeUserForStore, sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';

@Injectable()
export class UserEffects {
  constructor(
    private actions$: Actions,
    private firestoreQuery: FirestoreQueryService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private store: Store<AppState>
  ) { }

  observeUserChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(observeUserChanges),
      switchMap(({ uid }) =>
        this.store.pipe(
          select(selectUserById(uid)),
          switchMap(existingUser => {
            if (existingUser) {
              return of(loadUsersSuccess({ users: [sanitizeUserForStore(existingUser)] }));
            }

            return this.firestoreUserQuery.getUser(uid).pipe(
              map(user =>
                user
                  ? loadUsersSuccess({ users: [sanitizeUserForStore(user as IUserDados)] })
                  : loadUsersFailure({ error: { message: `Usuário ${uid} não encontrado.` } })
              ),
              catchError(error =>
                of(loadUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } }))
              )
            );
          })
        )
      )
    )
  );

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() =>
        this.firestoreQuery.getDocumentsByQuery<IUserDados>('users', []).pipe(
          map(users => loadUsersSuccess({ users: sanitizeUsersForStore(users) })),
          catchError(error => of(loadUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } })))
        )
      )
    )
  );
}
