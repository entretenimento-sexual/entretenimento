// src/app/store/effects/auth.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { login, loginSuccess, loginFailure } from '../actions/auth.actions';
import { catchError, map, of, switchMap } from 'rxjs';

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
        console.log('Iniciando o processo de login no AuthEffects...');
        return this.loginService.login(email, password).then(response => {
          if (response.success && response.user) {
            if (response.emailVerified) {
              console.log('Login bem-sucedido e e-mail verificado. Disparando loginSuccess.');
              return loginSuccess({ user: response.user });
            } else {
              console.warn('Login bem-sucedido, mas e-mail não verificado.');
              return loginFailure({ error: 'Email não verificado.' });
            }
          } else {
            console.error('Falha no login: Credenciais inválidas ou usuário não encontrado.');
            return loginFailure({ error: 'Credenciais inválidas ou usuário não encontrado.' });
          }
        }).catch(error => {
          console.error('Erro ao processar login:', error);
          return loginFailure({ error });
        });
      })
    )
  );
}
