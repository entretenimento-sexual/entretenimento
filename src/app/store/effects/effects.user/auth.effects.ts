// src/app/store/effects/auth.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { catchError, from, map, of, switchMap } from 'rxjs';
import { login, loginFailure, loginSuccess, register, registerFailure, registerSuccess } from '../../actions/actions.user/auth.actions';
import { UserRegistrationFlowService } from 'src/app/core/services/user-registration/user-registration-flow.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data'; // Importe a interface
import { User } from 'firebase/auth'; // Importe o tipo User do Firebase Auth
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service'; // Importe o GlobalErrorHandlerService
import { Timestamp } from '@firebase/firestore'; // Importe Timestamp para usar em acceptedTerms

@Injectable()
export class AuthEffects {
  constructor(
    private actions$: Actions,
    private loginService: LoginService,
    private userRegistrationFlow: UserRegistrationFlowService,
    private globalErrorHandler: GlobalErrorHandlerService // Injete o GlobalErrorHandlerService
  ) { }

  register$ = createEffect(() =>
    this.actions$.pipe(
      ofType(register),
      switchMap(({ email, password, nickname }) => {
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

        return this.userRegistrationFlow
          .handleNewUserRegistration(userRegistrationData, password)
          .pipe(
            map((user: User) => {
              console.log('[AuthEffects] Registro bem-sucedido. Usuário:', user.uid);
              return registerSuccess({ user });
            }),
            catchError((error) => {
              // AQUI: Apenas use error.message, pois o erro já foi formatado
              // e notificado pelos serviços de nível inferior.
              const errorMessage = error.message || 'Erro desconhecido durante o registro.';
              console.error('[AuthEffects] Erro durante o registro:', errorMessage, error);
              return of(registerFailure({ error: errorMessage }));
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
