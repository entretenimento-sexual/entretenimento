// src/app/store/effects/effects.user/auth.effects.ts
// =============================================================================
// AUTH EFFECTS
// =============================================================================
// - Orquestra intents legadas de login/registro.
// - A verdade da sessão permanece em Firebase Auth + AuthSessionService.
// - Não decide onboarding, presença ou lifecycle da conta.
// - Nunca cria evidência de aceite dos termos em nome do usuário.
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
  loginSessionReady,
  loginSuccess,
  register,
  registerFailure,
  registerSuccess,
} from '../../actions/actions.user/auth.actions';

@Injectable()
export class AuthEffects {
  private readonly debug =
    !environment.production && environment.enableDebugTools === true;

  constructor(
    private readonly actions$: Actions,
    private readonly loginService: LoginService,
    private readonly registerService: RegisterService
  ) {}

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.debug(`[AuthEffects] ${message}`, extra ?? '');
  }

  private maskEmail(email: string | null | undefined): string {
    const normalized = String(email ?? '').trim();
    if (!normalized) return '';

    const [localPart, domain] = normalized.split('@');
    return localPart && domain
      ? `${localPart.slice(0, 2)}***@${domain}`
      : '***';
  }

  register$ = createEffect(() =>
    this.actions$.pipe(
      ofType(register),
      exhaustMap(({ email, password, nickname, acceptedTerms }) => {
        const acceptedAt = Number(acceptedTerms?.date ?? 0);
        const hasValidTermsEvidence =
          acceptedTerms?.accepted === true &&
          Number.isFinite(acceptedAt) &&
          acceptedAt > 0 &&
          acceptedAt <= Date.now() + 60_000;

        if (!hasValidTermsEvidence) {
          this.dbg('register:blocked-without-terms', {
            email: this.maskEmail(email),
          });

          return of(
            registerFailure({
              error:
                'Confirme o aceite dos termos atuais antes de criar a conta.',
            })
          );
        }

        const now = Date.now();
        const userRegistrationData: IUserRegistrationData = {
          email: String(email ?? '').trim().toLowerCase(),
          nickname: String(nickname ?? '').trim(),
          acceptedTerms: {
            accepted: true,
            date: Math.trunc(acceptedAt),
          },
          emailVerified: false,
          isSubscriber: false,
          firstLogin: now,
          registrationDate: now,
          profileCompleted: false,
        };

        this.dbg('register:start', {
          email: this.maskEmail(email),
          nicknameLength: userRegistrationData.nickname.length,
        });

        return this.registerService
          .registerUser(userRegistrationData, password)
          .pipe(
            tap((credential: UserCredential) =>
              this.dbg('register:success', {
                uid: credential.user?.uid ?? null,
                emailVerified:
                  credential.user?.emailVerified === true,
              })
            ),
            map((credential: UserCredential) =>
              registerSuccess({ user: credential.user })
            ),
            catchError((error: unknown) => {
              const source = error as {
                message?: unknown;
                code?: unknown;
              } | null;
              const message = String(
                source?.message ??
                  'Erro desconhecido durante o registro.'
              );

              this.dbg('register:failure', {
                email: this.maskEmail(email),
                message,
                code: source?.code ?? null,
              });

              return of(registerFailure({ error: message }));
            })
          );
      })
    )
  );

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(login),
      exhaustMap(({ email, password }) => {
        this.dbg('login:start', { email: this.maskEmail(email) });

        return this.loginService.login$(email, password).pipe(
          map((response) => {
            if (!response.success || !response.user) {
              const message =
                response.message ??
                'Credenciais inválidas ou usuário não encontrado.';

              this.dbg('login:failure', {
                email: this.maskEmail(email),
                code: response.code ?? null,
                message,
              });

              return loginFailure({ error: message });
            }

            const profileConfirmed =
              response.profileResolution === 'resolved' &&
              typeof response.user.profileCompleted === 'boolean';

            this.dbg('login:success', {
              uid: response.user.uid,
              emailVerified: response.emailVerified === true,
              profileResolution:
                response.profileResolution ?? 'unknown',
              profileConfirmed,
            });

            /**
             * SUPRESSÃO EXPLÍCITA:
             * o fallback mínimo do Auth não é enviado ao loginSuccess enquanto
             * users/{uid} não tiver sido confirmado. A sessão continua válida e
             * a hidratação oficial permanece nos efeitos/store canônicos.
             */
            return profileConfirmed
              ? loginSuccess({ user: response.user })
              : loginSessionReady();
          }),
          catchError((error: unknown) => {
            const source = error as { message?: unknown; code?: unknown } | null;
            const errorMessage = String(
              source?.message ?? 'Erro desconhecido durante o login.'
            );

            this.dbg('login:exception', {
              email: this.maskEmail(email),
              message: errorMessage,
              code: source?.code ?? null,
            });

            return of(loginFailure({ error: errorMessage }));
          })
        );
      })
    )
  );
}
