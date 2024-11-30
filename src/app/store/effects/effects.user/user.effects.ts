// src/app/store/effects/user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  observeUserChanges,
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  loadOnlineUsers,
  loadOnlineUsersSuccess,
  loadOnlineUsersFailure
} from '../../actions/actions.user/user.actions';
import { FirestoreQueryService } from 'src/app/core/services/autentication/firestore-query.service';
import { catchError, map, switchMap, withLatestFrom, of, from } from 'rxjs';
import { Store, select } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { selectUserById } from '../../selectors/selectors.user/user.selectors';

@Injectable()
export class UserEffects {
  constructor(
    private actions$: Actions,
    private firestoreQueryService: FirestoreQueryService,
    private store: Store<AppState>
  ) { }

  /**
   * Observa mudanças de estado de um usuário específico.
   */
  observeUserChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(observeUserChanges),
      switchMap(action => {
        const uid = action.uid;
        console.log(`Ação observada para o UID: ${uid}`);

        // Verifica se o usuário já está no estado
        return this.store.pipe(
          select(selectUserById(uid)),
          switchMap(existingUser => {
            if (existingUser) {
              console.log(`Usuário já encontrado no estado: ${uid}`);
              return of(loadUsersSuccess({ users: [existingUser] }));
            }

            // Caso o usuário não esteja no estado, busca no Firestore
            console.log(`Usuário não encontrado no estado, buscando no Firestore: ${uid}`);
            return from(this.firestoreQueryService.getUserData(uid)).pipe(
              map(user => {
                if (user) {
                  console.log(`Usuário carregado com sucesso do Firestore: ${uid}`);
                  return loadUsersSuccess({ users: [user] });
                } else {
                  console.error(`Usuário com UID ${uid} não encontrado no Firestore.`);
                  return loadUsersFailure({ error: { message: `Usuário ${uid} não encontrado.` } });
                }
              }),
              catchError(error => {
                console.error(`Erro ao buscar usuário no Firestore: ${error.message}`);
                return of(loadUsersFailure({ error: { message: error.message } }));
              })
            );
          })
        );
      }),
      catchError(error => {
        console.error(`Erro no efeito observeUserChanges: ${error.message}`);
        return of(loadUsersFailure({ error: { message: error.message } }));
      })
    )
  );

  /**
   * Carrega todos os usuários.
   */
  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() => {
        console.log('Carregando todos os usuários...');
        return this.firestoreQueryService.getAllUsers().pipe(
          map(users => {
            console.log('Usuários carregados com sucesso do Firestore:', users);
            return loadUsersSuccess({ users });
          }),
          catchError(error => {
            console.error('Erro ao carregar todos os usuários:', error);
            return of(loadUsersFailure({ error: { message: error.message } }));
          })
        );
      })
    )
  );

  /**
   * Carrega todos os usuários online.
   */
  loadOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      switchMap(() => {
        console.log('Carregando todos os usuários online...');
        return this.firestoreQueryService.getOnlineUsers().pipe(
          map(users => {
            console.log('Usuários online carregados com sucesso:', users);
            return loadOnlineUsersSuccess({ users });
          }),
          catchError(error => {
            console.error('Erro ao carregar usuários online:', error);
            return of(loadOnlineUsersFailure({ error: { message: error.message } }));
          })
        );
      })
    )
  );
}
