// effects/online-users/online-users.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { loadOnlineUsers, loadOnlineUsersSuccess, loadOnlineUsersFailure, setFilteredOnlineUsers } from '../actions/user.actions';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { catchError, map, mergeMap, withLatestFrom } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable()
export class OnlineUsersEffects {
  
  // Efeito que carrega usuários online
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

  // Efeito para filtrar os usuários online pelo município do usuário logado
  filterOnlineUsersByMunicipio$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsersSuccess),
      withLatestFrom(this.authService.getUserAuthenticated()),
      map(([{ users }, user]) => {
        if (user && user.municipio) {
          const filteredUsers = users.filter(u => u.municipio === user.municipio);
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
