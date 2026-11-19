// src/app/core/services/autentication/register/email-link-registration.service.ts
// Laboratório exclusivamente emulado: API de cadastro por link sem trocar
// o RegisterService atual. Nenhum campo de senha ou token é persistido aqui.
import { Injectable } from '@angular/core';
import type { Auth, UserCredential } from '@angular/fire/auth';
import {
  getAdditionalUserInfo,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  updatePassword,
} from 'firebase/auth';
import { defer, from, map, Observable, tap, timeout, catchError, throwError } from 'rxjs';

import { environment } from 'src/environments/environment';
import { ValidatorService } from '../../general/validator.service';
import { AuthSessionService } from '../auth/auth-session.service';
import { ApplicationErrorService } from '../../error-handler/application-error.service';

const ACTION_TIMEOUT_MS = 15_000;
type LocalCode =
  | 'registration/email-link-preview-disabled'
  | 'registration/session-active'
  | 'registration/session-changed'
  | 'registration/invalid-email'
  | 'registration/invalid-link'
  | 'registration/adult-declaration-required'
  | 'registration/invalid-password';

type LocalError = Error & { code: LocalCode; localValidation: true };

function localError(code: LocalCode, message: string): LocalError {
  return Object.assign(new Error(message), { code, localValidation: true as const });
}

/** Nenhuma feature flag de produção pode habilitar este laboratório. */
export function emailLinkSignupPreviewAllowed(
  config: Pick<typeof environment, 'production' | 'useEmulators' | 'features'>
): boolean {
  return config.production === false &&
    config.useEmulators === true &&
    config.features?.emailFirstSignupPreview === true;
}

function checkedEmail(input: string): string {
  const email = String(input ?? '').trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw localError('registration/invalid-email', 'Confira o endereço de e-mail informado.');
  }
  return email;
}

export interface EmailLinkRegistrationIdentity {
  readonly uid: string;
  readonly email: string;
  readonly newUser: boolean;
}

@Injectable({ providedIn: 'root' })
export class EmailLinkRegistrationService {
  constructor(
    private readonly auth: Auth,
    private readonly session: AuthSessionService,
    private readonly errors: ApplicationErrorService
  ) {}

  /**
   * Só solicita o link. Não cria UID e não presume declaração de maioridade.
   * A declaração pré-Auth é exigida ao CONSUMIR o link (inclusive noutro dispositivo).
   * Sem retry automático: timeout de envio não prova que o e-mail não foi enviado.
   */
  requestLink$(emailInput: string): Observable<void> {
    return defer(() => {
      this.assertPreview();
      this.assertNoSession();
      const email = checkedEmail(emailInput);
      const origin = this.localOrigin();
      const settings = {
        url: `${origin}/register/continuar-por-email`,
        handleCodeInApp: true,
      };
      return from(sendSignInLinkToEmail(this.auth, email, settings)).pipe(
        timeout({ first: ACTION_TIMEOUT_MS }),
        map(() => void 0)
      );
    }).pipe(catchError((error: unknown) => this.reportAndRethrow(error, 'requestEmailLink')));
  }

  /**
   * A posse do e-mail não prova maioridade. A declaração precisa ter sido
   * confirmada nesta página antes de qualquer chamada que crie o UID.
   * Nunca buscar identidade pelo e-mail nem colocar o endereço no link.
   */
  completeLink$(
    emailInput: string,
    fullLink: string,
    preAuthAdultDeclared: boolean
  ): Observable<EmailLinkRegistrationIdentity> {
    return defer(() => {
      this.assertPreview();
      this.assertNoSession();
      if (preAuthAdultDeclared !== true) {
        throw localError(
          'registration/adult-declaration-required',
          'Confirme que você tem 18 anos ou mais antes de continuar.'
        );
      }
      const email = checkedEmail(emailInput);
      if (!isSignInWithEmailLink(this.auth, fullLink)) {
        throw localError('registration/invalid-link', 'Este link não é válido para confirmar o e-mail.');
      }
      const sessionVersion = this.session.terminationVersionSnapshot;
      return from(signInWithEmailLink(this.auth, email, fullLink)).pipe(
        timeout({ first: ACTION_TIMEOUT_MS }),
        map((credential: UserCredential) => {
          if (
            this.session.isTerminatingSnapshot ||
            this.session.terminationVersionSnapshot !== sessionVersion ||
            this.auth.currentUser?.uid !== credential.user.uid ||
            credential.user.email?.toLowerCase() !== email.toLowerCase() ||
            credential.user.emailVerified !== true
          ) {
            throw localError('registration/session-changed',
              'A sessão mudou durante a confirmação. Confira a conta antes de continuar.');
          }
          return {
            uid: credential.user.uid,
            email,
            newUser: getAdditionalUserInfo(credential)?.isNewUser === true,
          };
        })
      );
    }).pipe(catchError((error: unknown) => this.reportAndRethrow(error, 'completeEmailLink')));
  }

  /**
   * A futura página de senha informa explicitamente o UID retornado pelo link.
   * Nenhum valor desta etapa entra em Firestore, sessionStorage ou telemetry.
   */
  setPassword$(
    expectedUid: string,
    expectedEmail: string,
    password: string,
    confirmation: string
  ): Observable<void> {
    return defer(() => {
      this.assertPreview();
      const user = this.auth.currentUser;
      const uid = expectedUid.trim();
      const email = checkedEmail(expectedEmail);
      if (
        !uid || user?.uid !== uid ||
        user.email?.toLowerCase() !== email.toLowerCase() ||
        user.emailVerified !== true ||
        this.session.isTerminatingSnapshot
      ) {
        throw localError('registration/session-changed',
          'A conta ativa mudou. Confirme sua identidade novamente para criar a senha.');
      }
      if (
        password !== confirmation ||
        !ValidatorService.isValidPassword(password, 8)
      ) {
        throw localError('registration/invalid-password',
          'Confira a senha e a confirmação antes de continuar.');
      }

      const sessionVersion = this.session.terminationVersionSnapshot;
      return from(updatePassword(user, password)).pipe(
        timeout({ first: ACTION_TIMEOUT_MS }),
        tap(() => {
          if (
            this.session.isTerminatingSnapshot ||
            this.session.terminationVersionSnapshot !== sessionVersion ||
            this.auth.currentUser?.uid !== uid
          ) {
            throw localError('registration/session-changed',
              'A sessão mudou ao definir a senha. Verifique sua conta antes de continuar.');
          }
        }),
        map(() => void 0)
      );
    }).pipe(catchError((error: unknown) => this.reportAndRethrow(error, 'setEmailLinkPassword')));
  }

  private assertPreview(): void {
    if (!emailLinkSignupPreviewAllowed(environment)) {
      throw localError('registration/email-link-preview-disabled',
        'Este fluxo ainda não está liberado.');
    }
  }

  private assertNoSession(): void {
    if (this.session.isTerminatingSnapshot || this.auth.currentUser) {
      throw localError('registration/session-active',
        'Você já possui uma sessão ativa. Saia antes de iniciar um cadastro diferente.');
    }
  }

  private localOrigin(): string {
    if (typeof location === 'undefined' ||
        !['localhost', '127.0.0.1'].includes(location.hostname) ||
        location.protocol !== 'http:') {
      throw localError('registration/email-link-preview-disabled',
        'O teste exige o ambiente emulado local.');
    }
    return location.origin;
  }

  private reportAndRethrow(error: unknown, operation: string): Observable<never> {
    if ((error as Partial<LocalError> | null)?.localValidation !== true) {
      try {
        this.errors.report(error, {
          feature: 'registration-email-link-preview',
          operation,
          fallbackMessage: 'Não foi possível concluir esta etapa do e-mail.',
          presentation: { surface: 'none', severity: 'error' },
          metadata: { scope: 'EmailLinkRegistrationService' },
        });
      } catch {
        // A camada central não deve alterar a falha original.
      }
    }
    return throwError(() => error);
  }
}
