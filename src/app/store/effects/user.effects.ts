// src/app/store/effects/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import {
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  updateUserOnlineStatus,
  updateUserOnlineStatusSuccess,
  updateUserOnlineStatusFailure,
  loadOnlineUsers,
  loadOnlineUsersSuccess,
  loadOnlineUsersFailure,
  setFilteredOnlineUsers
} from '../actions/user.actions';
import { catchError, map, mergeMap, withLatestFrom } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Injectable()
export class UserEffects {

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


  // Efeito para atualizar o status online de um usuário específico
  updateUserOnlineStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(updateUserOnlineStatus), // Ação que dispara a atualização do status online de um usuário
      mergeMap(({ uid, isOnline }) =>
        this.usuarioService.updateUserOnlineStatus(uid, isOnline).pipe( // Atualiza o status online do usuário no serviço
          map(() => updateUserOnlineStatusSuccess({ uid, isOnline })), // Em caso de sucesso, dispara a ação de sucesso
          catchError(error => of(updateUserOnlineStatusFailure({ error }))) // Em caso de erro, dispara a ação de falha
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
    private actions$: Actions, // Injetando as ações do NgRx
    private usuarioService: UsuarioService, // Injetando o serviço de usuários
    private authService: AuthService // Injetando o serviço de autenticação
  ) { }
}
