// src/app/store/effects/auth.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { catchError, from, map, of, switchMap } from 'rxjs';
import { login, loginFailure, loginSuccess, register, registerFailure, registerSuccess } from '../../actions/actions.user/auth.actions';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data'; // Importe a interface
import { User, UserCredential } from 'firebase/auth'; // Importe o tipo User do Firebase Auth
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service'; // Importe o GlobalErrorHandlerService
import { Timestamp } from '@firebase/firestore'; // Importe Timestamp para usar em acceptedTerms
import { RegisterService } from 'src/app/core/services/autentication/register/register.service';

@Injectable()
export class AuthEffects {
  constructor(
    private actions$: Actions,
    private loginService: LoginService,
    private registerService: RegisterService,
    private globalErrorHandler: GlobalErrorHandlerService // Injete o GlobalErrorHandlerService
  ) { }

  register$ = createEffect(() =>
    this.actions$.pipe(
      ofType(register),
      switchMap(({ email, password, nickname }) => {
        console.log('[AuthEffects] register$ disparado para:', email, 'nickname:', nickname);
        // Construa o objeto IUserRegistrationData
        const userRegistrationData: IUserRegistrationData = {
          email,
          nickname,
          acceptedTerms: {
            accepted: true,
            date: Timestamp.fromDate(new Date())
          },
          emailVerified: false,
          isSubscriber: false,
          firstLogin: Timestamp.fromDate(new Date()),
          profileCompleted: false
        };

        console.log('[AuthEffects] Dados de registro do usuário:', userRegistrationData);

        return this.registerService.registerUser(userRegistrationData, password).pipe(
          map((cred: UserCredential) => {
            console.log('[AuthEffects] registerUser retornou UserCredential:', cred.user.uid);
            // no caso de sucesso, disparar success com o próprio User
            return registerSuccess({ user: cred.user });
          }),
          catchError((error: any) => {
            console.error('[AuthEffects] register$ erro formatado:', error.message);
            // error já vem formatado pelo GlobalErrorHandler
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
      switchMap(({ email, password }) => {
        console.log('[AuthEffects] Iniciando login para:', email);
        return from(this.loginService.login(email, password)).pipe(
          map(response => {
            console.log('[AuthEffects] loginService.login retornou:', response);
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
            // AQUI: Apenas use error.message, pois o erro já foi formatado
            // e notificado pelos serviços de nível inferior (se aplicável ao loginService).
            const errorMessage = error.message || 'Erro desconhecido durante o login.';
            console.error('[AuthEffects] Erro durante login (formatado):', errorMessage, error);
            return of(loginFailure({ error: errorMessage }));
          })
        );
      })
    )
  );
}
