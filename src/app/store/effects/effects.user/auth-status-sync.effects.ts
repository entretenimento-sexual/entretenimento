// src/app/store/effects/effects.user/auth-status-sync.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { of, from } from 'rxjs';
import {
  loginSuccess,
  logout,
  updateUserOnlineStatusSuccess,
  updateUserOnlineStatusFailure
} from '../../actions/actions.user/auth.actions'; // Corrigido para importar do arquivo correto
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Injectable()
export class AuthStatusSyncEffects {
  constructor(
    private actions$: Actions,
    private usuarioService: UsuarioService,
    private authService: AuthService
  ) { }

  // Efeito para sincronizar o status online do usuário após login
  setUserOnlineAfterLogin$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loginSuccess),
      mergeMap(({ user }) => {
        console.log('Atualizando status do usuário para online após login:', user.uid);
        return from(this.usuarioService.updateUserOnlineStatus(user.uid, true)).pipe(
          map(() => updateUserOnlineStatusSuccess({ uid: user.uid, isOnline: true })),
          catchError(error => {
            console.error('Erro ao atualizar status para online:', error);
            return of(updateUserOnlineStatusFailure({ error }));
          })
        );
      })
    )
  );

  // Efeito para atualizar o estado do usuário para offline no Firestore após logout
  setUserOfflineAfterLogout$ = createEffect(() =>
    this.actions$.pipe(
      ofType(logout),
      mergeMap(() => {
        const uid = this.authService.getLoggedUserUID();

        if (uid) {
          console.log('Atualizando status do usuário para offline após logout:', uid);
          return from(this.usuarioService.updateUserOnlineStatus(uid, false)).pipe(
            map(() => updateUserOnlineStatusSuccess({ uid, isOnline: false })),
            catchError(error => {
              console.error('Erro ao atualizar status para offline:', error);
              return of(updateUserOnlineStatusFailure({ error }));
            })
          );
        } else {
          console.error('UID não encontrado para a ação de logout.');
          return of(updateUserOnlineStatusFailure({ error: 'UID não encontrado para a ação de logout.' }));
        }
      })
    )
  );
}
