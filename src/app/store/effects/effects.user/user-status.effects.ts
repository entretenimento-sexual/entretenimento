// effects/user-status/user-status.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { catchError, map, mergeMap, throttleTime } from 'rxjs/operators';
import { of } from 'rxjs';
import { updateUserOnlineStatusSuccess, updateUserOnlineStatusFailure } from '../../actions/actions.user/user-status.actions';
import { updateUserOnlineStatus } from '../../actions/actions.user/user.actions';

@Injectable()
export class UserStatusEffects {
  // Efeito para atualizar o status online de um usuário específico
  updateUserOnlineStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(updateUserOnlineStatus),
      throttleTime(1000),
      mergeMap(({ uid, isOnline }) =>
        this.usuarioService.updateUserOnlineStatus(uid, isOnline).pipe(
          map(() => updateUserOnlineStatusSuccess({ uid, isOnline })),
          catchError(error => of(updateUserOnlineStatusFailure({ error })))
        )
      )
    )
  );

  constructor(
    private actions$: Actions,
    private usuarioService: UsuarioService
  ) { }
}
