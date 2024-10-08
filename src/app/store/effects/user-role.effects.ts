// effects/user/user-role.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { updateUserRole, updateUserRoleSuccess, updateUserRoleFailure } from '../actions/user-role.actions';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable()
export class UserRoleEffects {
  // Efeito para atualizar o papel (role) de um usuário
  updateUserRole$ = createEffect(() =>
    this.actions$.pipe(
      ofType(updateUserRole),
      mergeMap(({ uid, newRole }) =>
        this.usuarioService.updateUserRole(uid, newRole).pipe(
          map(() => updateUserRoleSuccess({ uid, newRole })),
          catchError(error => of(updateUserRoleFailure({ error })))
        )
      )
    )
  );

  constructor(
    private actions$: Actions,
    private usuarioService: UsuarioService
  ) { }
}
