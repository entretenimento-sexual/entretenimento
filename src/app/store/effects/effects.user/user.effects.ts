// src/app/store/effects/user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  observeUserChanges, loadUsers, loadUsersSuccess, loadUsersFailure, loadOnlineUsers,
  loadOnlineUsersSuccess, loadOnlineUsersFailure
} from '../../actions/actions.user/user.actions';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { catchError, map, switchMap, of, from } from 'rxjs';
import { Store, select } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { selectUserById } from '../../selectors/selectors.user/user.selectors';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

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
      switchMap(({ uid }) => {
        console.log('[UserEffects] observeUserChanges acionado para UID:', uid);
        return this.store.pipe(
          select(selectUserById(uid)),
          switchMap(existingUser => {
            if (existingUser) {
              console.log('[UserEffects] Usuário já está no estado:', existingUser);
              return of(loadUsersSuccess({ users: [existingUser] }));
            }
            console.log('[UserEffects] Buscando usuário no Firestore:', uid);
            return this.firestoreUserQuery.getUser(uid).pipe(
              map(user => {
                if (user) {
                  console.log('[UserEffects] Usuário encontrado no Firestore:', user);
                  return loadUsersSuccess({ users: [user] });
                } else {
                  console.log('[UserEffects] Usuário não encontrado no Firestore:', uid);
                  return loadUsersFailure({ error: { message: `Usuário ${uid} não encontrado.` } });
                }
              }),
              catchError(error => {
                console.log('[UserEffects] Erro ao buscar usuário no Firestore:', error?.message || error);
                return of(loadUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } }));
              })
            );
          })
        );
      })
    )
  );

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() => {
        console.log('[UserEffects] loadUsers acionado');
        return from(this.firestoreQuery.getDocumentsByQuery<IUserDados>('users', [])).pipe(
          map(users => {
            if (Array.isArray(users)) {
              console.log('[UserEffects] Usuários carregados:', users.length);
              return loadUsersSuccess({ users });
            }
            throw new Error('Dados inválidos recebidos do Firestore');
          }),
          catchError(error => {
            console.log('[UserEffects] Erro ao carregar usuários:', error?.message || error);
            return of(loadUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } }));
          })
        );
      })
    )
  );

  loadOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      switchMap(() => {
        console.log('[UserEffects] loadOnlineUsers acionado');
        return this.firestoreQuery.getOnlineUsers().pipe(
          map((users: IUserDados[]) => {
            console.log('[UserEffects] Usuários online carregados:', users.length);
            return loadOnlineUsersSuccess({ users });
          }),
          catchError(error => {
            console.log('[UserEffects] Erro ao carregar usuários online:', error?.message || error);
            return of(loadOnlineUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } }));
          })
        );
      })
    )
  );
}
