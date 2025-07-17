// effects/user/user-role.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { updateUserRole, updateUserRoleSuccess, updateUserRoleFailure } from '../../actions/actions.user/user-role.actions';

@Injectable()
export class UserRoleEffects {
  updateUserRole$ = createEffect(() =>
    this.actions$.pipe(
      ofType(updateUserRole),
      mergeMap(({ uid, newRole }) => {
        console.log('[UserRoleEffects] Atualizando role do usuário:', { uid, newRole });
        return this.usuarioService.updateUserRole(uid, newRole).pipe(
          map(() => {
            console.log('[UserRoleEffects] updateUserRoleSuccess:', { uid, newRole });
            return updateUserRoleSuccess({ uid, newRole });
          }),
          catchError(error => {
            console.log('[UserRoleEffects] Erro ao atualizar role do usuário:', error?.message || error);
            return of(updateUserRoleFailure({ error: error?.message || error }));
          })
        );
      })
    )
  );

  constructor(
    private actions$: Actions,
    private usuarioService: UsuarioService
  ) { }
}
