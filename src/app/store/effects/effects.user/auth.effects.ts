// src/app/store/effects/auth.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { of } from 'rxjs';
import { switchMap, map, catchError } from 'rxjs/operators';
import { login, loginFailure, loginSuccess, register, registerFailure, registerSuccess } from '../../actions/actions.user/auth.actions';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { UserCredential } from 'firebase/auth';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { Timestamp } from 'firebase/firestore';            // ✅ correto
import { RegisterService } from 'src/app/core/services/autentication/register/register.service';

@Injectable()
export class AuthEffects {
  constructor(
    private actions$: Actions,
    private loginService: LoginService,
    private registerService: RegisterService,
    private globalErrorHandler: GlobalErrorHandlerService
  ) { }

  register$ = createEffect(() =>
    this.actions$.pipe(
      ofType(register),
      switchMap(({ email, password, nickname }) => {
        const userRegistrationData: IUserRegistrationData = {
          email,
          nickname,
          acceptedTerms: { accepted: true, date: Timestamp.fromDate(new Date()) },
          emailVerified: false,
          isSubscriber: false,
          firstLogin: Timestamp.fromDate(new Date()),
          profileCompleted: false
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
