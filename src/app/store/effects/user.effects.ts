// effects/user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { observeUserChanges, loadUsers, loadUsersSuccess, loadUsersFailure } from '../actions/user.actions';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable()
export class UserEffects {
  // Efeito para observar mudanças no usuário
  observeUserChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(observeUserChanges),
      mergeMap(({ uid }) =>
        this.usuarioService.getUsuario(uid).pipe(
          map(user => {
            if (user) {
              return loadUsersSuccess({ users: [user] });
            } else {
              return loadUsersFailure({ error: { message: 'Usuário não encontrado' } });
            }
          }),
          catchError(error => of(loadUsersFailure({ error })))
        )
      )
    )
  );

  // Efeito para carregar todos os usuários
  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
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
    private usuarioService: UsuarioService
  ) { }
}
