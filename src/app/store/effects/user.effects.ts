// effects/user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { observeUserChanges, loadUsersFailure, loadUsersSuccess } from '../actions/user.actions';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { catchError, map, mergeMap, withLatestFrom } from 'rxjs/operators';
import { of } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from '../states/app.state';
import { selectUserById } from '../selectors/user.selectors';

@Injectable()

export class UserEffects {

  // Efeito para observar mudanças no usuário
  observeUserChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(observeUserChanges),
      mergeMap(action =>
        this.store.select(selectUserById(action.uid)).pipe(
          withLatestFrom(of(action.uid)), // Pega o UID da ação
          mergeMap(([existingUser, uid]) => {
            if (existingUser) {
              console.log(`Usuário já está no estado: ${uid}`);
              // Retorna uma ação de sucesso diretamente se o usuário já estiver no estado
              return of(loadUsersSuccess({ users: [existingUser] }));
            } else {
              console.log(`Buscando usuário no Firestore: ${uid}`);
              // Se não houver usuário no estado, busca no Firestore
              return this.usuarioService.getUsuario(uid).pipe(
                map(user => {
                  if (user) {
                    return loadUsersSuccess({ users: [user] });
                  } else {
                    return loadUsersFailure({ error: { message: 'Usuário não encontrado' } });
                  }
                }),
                catchError(error => of(loadUsersFailure({ error })))
              );
            }
          })
        )
      )
    )
  );

  // Efeito para carregar todos os usuários
  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType('[User] Load Users'), // Corrige o nome da ação
      mergeMap(() =>
        this.usuarioService.getAllUsers().pipe(
          map(users => loadUsersSuccess({ users })),
          catchError(error => of(loadUsersFailure({ error })))
        )
      )
    )
  );

  constructor(
    private actions$: Actions,
    private usuarioService: UsuarioService,
    private store: Store<AppState>
  ) { }
}
