// src\app\store\effects\effects.user\auth.effects.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { of } from 'rxjs';
import { switchMap, map, catchError } from 'rxjs/operators';
import { login, loginFailure, loginSuccess, register, registerFailure, registerSuccess } from '../../actions/actions.user/auth.actions';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { UserCredential } from 'firebase/auth';
import { RegisterService } from 'src/app/core/services/autentication/register/register.service';

@Injectable()
export class AuthEffects {
  constructor(
    private actions$: Actions,
    private loginService: LoginService,
    private registerService: RegisterService,
  ) { }

  register$ = createEffect(() =>
    this.actions$.pipe(
      ofType(register),
      switchMap(({ email, password, nickname }) => {
        const now = Date.now();
        const userRegistrationData: IUserRegistrationData = {
          email,
          nickname,
          acceptedTerms: { accepted: true, date: now },
          emailVerified: false,
          isSubscriber: false,
          firstLogin: now,
          registrationDate: now,
          profileCompleted: false,
        };
        return this.registerService.registerUser(userRegistrationData, password).pipe(
          map((cred: UserCredential) => registerSuccess({ user: cred.user })),
          catchError((error: any) => {
            const msg = error?.message || 'Erro desconhecido durante o registro.';
            return of(registerFailure({ error: msg }));
          })
        );
      })
    )
  );

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(login),
      switchMap(({ email, password }) =>
        this.loginService.login$(email, password).pipe(       // ✅ usa login$
          map(response => {
            if (!response.success) {
              return loginFailure({ error: response.message || 'Credenciais inválidas ou usuário não encontrado.' });
            }
            if (response.success && !response.emailVerified) {
              return loginFailure({ error: 'E-mail não verificado.' });
            }
            return loginSuccess({ user: response.user! });
          }),
          catchError(error => {
            const errorMessage = error?.message || 'Erro desconhecido durante o login.';
            return of(loginFailure({ error: errorMessage }));
          })
        )
      )
    )
  );
}
