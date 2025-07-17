import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { catchError, map, mergeMap, withLatestFrom, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { loadOnlineUsers, loadOnlineUsersSuccess, loadOnlineUsersFailure, setFilteredOnlineUsers } from '../../actions/actions.user/user.actions';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';

@Injectable()
export class OnlineUsersEffects {
  loadOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      tap(() => console.log('[OnlineUsersEffects] loadOnlineUsers acionado')),
      mergeMap(() =>
        this.firestoreQuery.getOnlineUsers().pipe(
          map(users => {
            console.log('[OnlineUsersEffects] Usuários online recebidos:', users.length);
            return loadOnlineUsersSuccess({ users });
          }),
          catchError(error => {
            console.log('[OnlineUsersEffects] Erro ao carregar usuários online:', error);
            return of(loadOnlineUsersFailure({ error }));
          })
        )
      )
    )
  );

  filterOnlineUsersByMunicipio$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsersSuccess),
      tap(({ users }) => console.log('[OnlineUsersEffects] loadOnlineUsersSuccess recebido:', users.length)),
      withLatestFrom(this.authService.user$),
      map(([{ users }, user]) => {
        if (user && user.municipio) {
          const filteredUsers = users.filter((u: IUserDados) => u.municipio === user.municipio);
          console.log('[OnlineUsersEffects] Usuários filtrados:', filteredUsers.length, 'para município:', user.municipio);
          return setFilteredOnlineUsers({ filteredUsers });
        }
        console.log('[OnlineUsersEffects] Nenhum filtro aplicado. Usuário não autenticado ou sem município.');
        return setFilteredOnlineUsers({ filteredUsers: [] });
      })
    )
  );

  constructor(
    private actions$: Actions,
    private firestoreQuery: FirestoreQueryService,
    private authService: AuthService
  ) { }
}
