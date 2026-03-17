// src/app/store/effects/effects.user/auth.effects.ts
// =============================================================================
// AUTH EFFECTS
//
// Objetivo:
// - Orquestrar intents de login/registro vindas da UI
// - Delegar autenticação real aos services
// - Transformar resposta em actions de sucesso/falha
//
// Importante nesta arquitetura:
// - A verdade da sessão NÃO nasce aqui.
// - A verdade da sessão nasce em:
//   1) Firebase Auth
//   2) AuthSessionService
//   3) AuthSessionSyncEffects
//
// Portanto:
// - Se o login autenticou, mesmo com emailVerified=false,
//   isso NÃO deve virar loginFailure.
// - O gating de usuário não verificado pertence ao fluxo de auth/orchestrator/guards,
//   não a este effect.
//
// Ajuste principal deste patch:
// - parar de tratar usuário autenticado porém não verificado como falha de login
// - adicionar observabilidade leve em dev
// - manter mensagens de erro consistentes
// =============================================================================

import { Injectable } from '@angular/core';

import { Actions, createEffect, ofType } from '@ngrx/effects';

import { of } from 'rxjs';
import { catchError, exhaustMap, map, tap } from 'rxjs/operators';

import { UserCredential } from 'firebase/auth';

import { environment } from 'src/environments/environment';

import { LoginService } from 'src/app/core/services/autentication/login.service';
import { RegisterService } from 'src/app/core/services/autentication/register/register.service';

import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

import {
  login,
  loginFailure,
  loginSuccess,
  register,
  registerFailure,
  registerSuccess,
} from '../../actions/actions.user/auth.actions';

@Injectable()
export class AuthEffects {
  private readonly debug =
    !environment.production && !!(environment as any)?.enableDebugTools;

  constructor(
    private readonly actions$: Actions,
    private readonly loginService: LoginService,
    private readonly registerService: RegisterService,
  ) {}

  // ---------------------------------------------------------------------------
  // Debug helpers
  // ---------------------------------------------------------------------------
  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthEffects] ${message}`, extra ?? '');
  }

  private maskEmail(email: string | null | undefined): string {
    const e = (email ?? '').trim();
    if (!e) return '';

    const [user, domain] = e.split('@');
    if (!user || !domain) return e;

    return `${user.slice(0, 2)}***@${domain}`;
  }

  // ---------------------------------------------------------------------------
  // REGISTER
  //
  // Observação:
  // - exhaustMap evita disparos concorrentes por múltiplos cliques
  // - o fluxo de sessão pós-registro continua sendo refletido pelo AuthSessionSync
  // ---------------------------------------------------------------------------
  register$ = createEffect(() =>
    this.actions$.pipe(
      ofType(register),

      exhaustMap(({ email, password, nickname }) => {
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

        this.dbg('register:start', {
          email: this.maskEmail(email),
          nicknameLength: (nickname ?? '').trim().length,
        });

        return this.registerService.registerUser(userRegistrationData, password).pipe(
          tap((cred: UserCredential) =>
            this.dbg('register:success', {
              uid: cred.user?.uid ?? null,
              emailVerified: cred.user?.emailVerified === true,
            })
          ),

          map((cred: UserCredential) => registerSuccess({ user: cred.user })),

          catchError((error: any) => {
            const msg = error?.message || 'Erro desconhecido durante o registro.';

            this.dbg('register:failure', {
              email: this.maskEmail(email),
              message: msg,
              code: error?.code ?? null,
            });

            return of(registerFailure({ error: msg }));
          })
        );
      })
    )
  );

  // ---------------------------------------------------------------------------
  // LOGIN
  //
  // Regra arquitetural importante:
  // - success=false => falha real de autenticação/login
  // - success=true  => a sessão existe
  //
  // Logo:
  // - success=true + emailVerified=false NÃO é loginFailure
  // - o bloqueio/redirecionamento do usuário não verificado deve acontecer
  //   no fluxo canônico de sessão/roteamento, e não aqui
  // ---------------------------------------------------------------------------
  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(login),

      exhaustMap(({ email, password }) => {
        this.dbg('login:start', {
          email: this.maskEmail(email),
        });

        return this.loginService.login$(email, password).pipe(
          map((response) => {
            // ---------------------------------------------------------------
            // Falha real de autenticação
            // ---------------------------------------------------------------
            if (!response.success || !response.user) {
              const message =
                response.message || 'Credenciais inválidas ou usuário não encontrado.';

              this.dbg('login:failure', {
                email: this.maskEmail(email),
                code: response.code ?? null,
                message,
              });

              return loginFailure({ error: message });
            }

            // ---------------------------------------------------------------
            // Sucesso real de autenticação
            //
            // Mesmo com emailVerified=false, a sessão existe e o restante do
            // fluxo precisa ser decidido pelo AuthSessionSync/AuthOrchestrator.
            // ---------------------------------------------------------------
            this.dbg('login:success', {
              uid: response.user.uid,
              emailVerified: response.emailVerified === true,
              needsProfileCompletion: response.needsProfileCompletion === true,
            });

            return loginSuccess({ user: response.user });
          }),

          catchError((error: any) => {
            const errorMessage =
              error?.message || 'Erro desconhecido durante o login.';

            this.dbg('login:exception', {
              email: this.maskEmail(email),
              message: errorMessage,
              code: error?.code ?? null,
            });

            return of(loginFailure({ error: errorMessage }));
          })
        );
      })
    )
  );
} // Linha 210, fim do auth.effects.ts
