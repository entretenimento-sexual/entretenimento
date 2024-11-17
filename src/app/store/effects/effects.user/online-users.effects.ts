// src/app/store/effects/online-users/online-users.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { catchError, map, mergeMap, withLatestFrom } from 'rxjs/operators';
import { of } from 'rxjs';
import { loadOnlineUsers, loadOnlineUsersSuccess, loadOnlineUsersFailure, setFilteredOnlineUsers } from '../../actions/actions.user/user.actions';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Injectable()
export class OnlineUsersEffects {
  loadOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      mergeMap(() =>
        this.usuarioService.getAllOnlineUsers().pipe(
          map(users => {
            console.log('Usuários online recebidos no efeito:', users);
            return loadOnlineUsersSuccess({ users });
          }),
          catchError(error => of(loadOnlineUsersFailure({ error })))
        )
      )
    )
  );

  filterOnlineUsersByMunicipio$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsersSuccess),
      withLatestFrom(this.authService.user$),
      map(([{ users }, user]) => {
        if (user && user.municipio) {
          const filteredUsers = users.filter((u: IUserDados) => u.municipio === user.municipio);
          return setFilteredOnlineUsers({ filteredUsers });
        }
        return setFilteredOnlineUsers({ filteredUsers: [] });
      })
    )
  );

  constructor(
    private actions$: Actions,
    private usuarioService: UsuarioService,
    private authService: AuthService
  ) { }
}
