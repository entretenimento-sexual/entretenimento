// src/app/store/effects/auth.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { catchError, from, map, of, switchMap } from 'rxjs';
import { login, loginFailure, loginSuccess } from '../../actions/actions.user/auth.actions';

@Injectable()
export class AuthEffects {
  constructor(
    private actions$: Actions,
    private loginService: LoginService
  ) { }

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(login),
      switchMap(({ email, password }) => {
        console.log('[AuthEffects] Iniciando login para:', email);
        return from(this.loginService.login(email, password)).pipe(
          map(response => {
            if (!response.success) {
              console.log('[AuthEffects] Login falhou. Usuário não encontrado ou erro.');
              return loginFailure({ error: 'Credenciais inválidas ou usuário não encontrado.' });
            }

            if (response.success && !response.emailVerified) {
              console.log('[AuthEffects] E-mail não verificado.');
              return loginFailure({ error: 'E-mail não verificado.' });
            }

            console.log('[AuthEffects] Login bem-sucedido. Usuário:', response.user?.uid);
            return loginSuccess({ user: response.user! });
          }),
          catchError(error => {
            const errorMessage = typeof error === 'string' ? error : (error.message || 'Erro desconhecido');
            console.log('[AuthEffects] Erro durante login:', errorMessage);
            return of(loginFailure({ error: errorMessage }));
          })
        );
      })
    )
  );
}
