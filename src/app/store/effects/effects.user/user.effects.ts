// effects/user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { observeUserChanges, loadUsersFailure, loadUsersSuccess } from '../../actions/actions.user/user.actions';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { catchError, map, switchMap, withLatestFrom } from 'rxjs/operators';
import { of } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { selectUserById } from '../../selectors/selectors.user/user.selectors';

@Injectable()
export class UserEffects {

  constructor(
    private actions$: Actions,
    private usuarioService: UsuarioService,
    private store: Store<AppState>
  ) { }

  // Efeito para observar mudanças no usuário
  observeUserChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(observeUserChanges),
      withLatestFrom(this.store.select(state => state.user)),
      switchMap(([action, userState]) => {
        const uid = action.uid;
        return this.store.select(selectUserById(uid)).pipe(
          switchMap(existingUser => {
            console.log(`Ação observada para o UID:`, uid);

            if (existingUser) {
              console.log(`Usuário já está no estado: ${uid}`);
              return of(loadUsersSuccess({ users: [existingUser] }));
            } else {
              console.log(`Usuário não encontrado no estado, buscando no Firestore: ${uid}`);
              return this.usuarioService.getUsuario(uid).pipe(
                map(user => {
                  if (user) {
                    console.log(`Usuário carregado com sucesso do Firestore: ${user?.uid}`);
                    return loadUsersSuccess({ users: [user] });
                  } else {
                    throw new Error(`Usuário com UID ${uid} não encontrado no Firestore`);
                  }
                }),
                catchError(error => {
                  console.error(`Erro ao carregar o usuário do Firestore: ${error.message}`);
                  return of(loadUsersFailure({ error: { message: error.message } }));
                })
              );
            }
          })
        );
      })
    )
  );


  // Efeito para carregar todos os usuários
  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType('[User] Load Users'), // Corrige o nome da ação
      switchMap(() =>
        this.usuarioService.getAllUsers().pipe(
          map(users => {
            console.log('Usuários carregados com sucesso:', users);
            return loadUsersSuccess({ users });
          }),
          catchError(error => {
            console.error('Erro ao carregar todos os usuários:', error);
            return of(loadUsersFailure({ error }));
          })
        )
      )
    )
  );
}
