// src/app/core/services/autentication/register/email-link-registration.service.ts
import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { Auth, type UserCredential } from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  beforeAuthStateChanged,
  EmailAuthProvider,
  isSignInWithEmailLink,
  parseActionCodeURL,
  reauthenticateWithCredential,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  updatePassword,
} from 'firebase/auth';
import { defer, finalize, from, map, Observable, of, switchMap, timeout, catchError, filter, startWith, Subject, throwError } from 'rxjs';

import { environment } from 'src/environments/environment';
import { ValidatorService } from '../../general/validator.service';
import { AuthSessionService } from '../auth/auth-session.service';
import { ApplicationErrorService } from '../../error-handler/application-error.service';

const ACTION_TIMEOUT_MS = 15_000;
const PREVIEW_UID_PREFIX = 'email-link-preview-';
export const EMAIL_LINK_REGISTRATION_ROUTE = '/register/continuar-por-email';
export const EMAIL_LINK_PASSWORD_ROUTE = '/register/definir-senha';

export function isEmailLinkPreviewUid(uid: string): boolean {
  return emailLinkSignupPreviewAllowed(environment) && uid.startsWith(PREVIEW_UID_PREFIX);
}
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

export type EmailLinkInspectionState = 'confirm' | 'sign-in' | 'unavailable' | 'draft-expired';

const EXPECTED_LINK_REJECTIONS = new Set([
  'registration/account-already-created',
  'registration/email-link-unavailable',
  'registration/email-link-draft-expired',
  'auth/invalid-action-code',
  'auth/expired-action-code',
]);

export interface EmailLinkRegistrationIdentity {
  readonly uid: string;
  readonly email: string;
}

@Injectable({ providedIn: 'root' })
export class EmailLinkRegistrationService {
  private readonly passwordChanged = new Subject<string>();
  private readonly firebase = {
    beforeAuthStateChanged, isSignInWithEmailLink, reauthenticateWithCredential,
    sendSignInLinkToEmail, signInWithEmailLink, updatePassword,
  };

  constructor(
    private readonly auth: Auth,
    private readonly session: AuthSessionService,
    private readonly errors: ApplicationErrorService,
    private readonly functions: Functions,
    private readonly injector: EnvironmentInjector,
  ) {}

  /**
   * Só solicita o link. Não cria UID e não presume declaração de maioridade.
   * A declaração pré-Auth é exigida ao CONSUMIR o link (inclusive noutro dispositivo).
   * Sem retry automático: timeout de envio não prova que o e-mail não foi enviado.
   */
  requestLink$(emailInput: string, nickname?: string): Observable<void> {
    return defer(() => {
      this.assertPreview();
      this.assertNoSession();
      const email = checkedEmail(emailInput);
      const origin = this.localOrigin();
      const target = new URL(EMAIL_LINK_REGISTRATION_ROUTE, origin);
      const stage$: Observable<string | null> = nickname
        ? from(this.callable<{ email: string; nickname: string }, { draftId: string }>(
            'stageEmailLinkRegistration'
          )({ email, nickname })).pipe(map(({ data }) => data.draftId))
        : of(null);
      return stage$.pipe(
        switchMap(draftId => {
          this.assertNoSession();
          if (draftId) target.searchParams.set('draft', draftId);
          return this.firebase.sendSignInLinkToEmail(this.auth, email, {
            url: target.href,
            handleCodeInApp: true,
          });
        }),
        timeout({ first: ACTION_TIMEOUT_MS }),
        map(() => void 0)
      );
    }).pipe(catchError((error: unknown) => this.reportAndRethrow(error, 'requestEmailLink')));
  }

  inspectLink$(fullLink: string): Observable<EmailLinkInspectionState> {
    return defer(() => {
      this.assertPreview();
      this.assertNoSession();
      this.localOrigin();
      const action = parseActionCodeURL(fullLink);
      if (!action || !this.firebase.isSignInWithEmailLink(this.auth, fullLink)) {
        return of('unavailable' as const);
      }
      const inspect = this.callable<{ code: string }, { state: EmailLinkInspectionState }>('inspectEmailLinkRegistration');
      return from(inspect({ code: action.code })).pipe(
        map(({ data }) => data.state),
        timeout({ first: ACTION_TIMEOUT_MS }),
      );
    }).pipe(catchError((error: unknown) => this.reportAndRethrow(error, 'inspectEmailLink')));
  }

  /**
   * A posse do e-mail não prova maioridade. A declaração precisa ter sido
   * confirmada nesta página antes de qualquer chamada que crie o UID.
   * O backend valida o código para este endereço e reserva um UID de cadastro.
   */
  completeLink$(fullLink: string, preAuthAdultDeclared: boolean): Observable<EmailLinkRegistrationIdentity> {
    return defer(() => {
      this.assertPreview();
      this.assertNoSession();
      this.localOrigin();
      if (preAuthAdultDeclared !== true) {
        throw localError(
          'registration/adult-declaration-required',
          'Confirme que você tem 18 anos ou mais antes de continuar.'
        );
      }
      const action = parseActionCodeURL(fullLink);
      if (!action || !this.firebase.isSignInWithEmailLink(this.auth, fullLink)) {
        throw localError('registration/invalid-link', 'Este link não é válido para confirmar o e-mail.');
      }
      const sessionVersion = this.session.terminationVersionSnapshot;
      const prepare = this.callable<{ code: string; confirmsAdult: boolean }, EmailLinkRegistrationIdentity>(
        'prepareEmailLinkRegistration'
      );
      return from(prepare({ code: action.code, confirmsAdult: true })).pipe(
        switchMap(({ data }) => {
          this.assertNoSession();
          if (this.session.terminationVersionSnapshot !== sessionVersion ||
              !data?.uid?.startsWith(PREVIEW_UID_PREFIX)) throw this.sessionChanged();
          return this.consumeForUid$(data.uid, sessionVersion, checkedEmail(data.email), fullLink);
        }),
        timeout({ first: ACTION_TIMEOUT_MS })
      );
    }).pipe(catchError((error: unknown) => this.reportAndRethrow(error, 'completeEmailLink')));
  }

  /**
   * Consulta somente a conta emulada autenticada. O backend lê a credencial no Auth.
   */
  passwordRequired$(uid: string): Observable<boolean> {
    return defer(() => {
      if (!isEmailLinkPreviewUid(uid)) return of(false);
      return this.readPasswordRequired$(uid);
    });
  }

  watchPasswordRequired$(uid: string): Observable<boolean> {
    return this.passwordChanged.pipe(
      filter(changedUid => changedUid === uid),
      startWith(uid),
      switchMap(() => this.passwordRequired$(uid)),
    );
  }

  setPassword$(
    expectedUid: string,
    expectedEmail: string,
    password: string,
    confirmation: string
  ): Observable<void> {
    return defer(() => {
      this.assertPreview();
      this.localOrigin();
      const user = this.auth.currentUser;
      const uid = expectedUid.trim();
      const email = checkedEmail(expectedEmail);
      if (
        !uid || user?.uid !== uid ||
        user.email?.toLowerCase() !== email.toLowerCase() ||
        user.emailVerified !== true ||
        this.session.isTerminatingSnapshot || !uid.startsWith(PREVIEW_UID_PREFIX)
      ) {
        throw localError('registration/session-changed',
          'A conta ativa mudou. Confirme sua identidade novamente para criar a senha.');
      }
      if (
        password !== confirmation ||
        password.length > 128 ||
        !ValidatorService.isValidPassword(password, 8)
      ) {
        throw localError('registration/invalid-password',
          'Confira a senha e a confirmação antes de continuar.');
      }

      const sessionVersion = this.session.terminationVersionSnapshot;
      const assertSession = () => {
        if (this.session.isTerminatingSnapshot || this.session.terminationVersionSnapshot !== sessionVersion ||
            this.auth.currentUser !== user) throw this.sessionChanged();
      };
      const reauthenticate$ = () => defer(() => {
        assertSession();
        return from(this.firebase.reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password)));
      });
      const readState$ = () => defer(() => {
        assertSession();
        return this.readPasswordRequired$(uid);
      });
      return readState$().pipe(
        catchError(error => error?.code === 'functions/unauthenticated'
          ? reauthenticate$().pipe(switchMap(readState$))
          : throwError(() => error)),
        switchMap(required => {
          assertSession();
          if (!required) return of(false);
          // Auth may revoke the email-link token when the password is defined.
          return from(this.firebase.updatePassword(user, password)).pipe(
            switchMap(reauthenticate$),
            switchMap(readState$),
          );
        }),
        map(required => {
          assertSession();
          if (required) throw localError('registration/invalid-password', 'Sua senha ainda não foi confirmada. Tente novamente.');
          this.passwordChanged.next(uid);
        }),
        timeout({ first: ACTION_TIMEOUT_MS }),
      );
    }).pipe(catchError((error: unknown) => this.reportAndRethrow(error, 'setEmailLinkPassword')));
  }

  preparedNickname$(uid: string): Observable<string | null> {
    return this.readRegistrationState$(uid).pipe(
      map(state => state.nickname ?? null),
      catchError((error: unknown) => this.reportAndRethrow(error, 'readPreparedNickname')),
    );
  }

  private readPasswordRequired$(uid: string): Observable<boolean> {
    return this.readRegistrationState$(uid).pipe(map(state => state.passwordRequired));
  }

  private readRegistrationState$(uid: string): Observable<{ passwordRequired: boolean; nickname?: string }> {
    return defer(() => {
      const query = this.callable<{ expectedUid: string }, { passwordRequired: boolean; nickname?: string }>(
        'getEmailLinkRegistrationState'
      );
      return from(query({ expectedUid: uid })).pipe(map(({ data }) => data));
    });
  }

  private consumeForUid$(uid: string, version: number, email: string, link: string): Observable<EmailLinkRegistrationIdentity> {
    let cancelled = false;
    const removeGuard = this.firebase.beforeAuthStateChanged(this.auth, next => {
      if (next?.uid === uid && (cancelled || this.session.isTerminatingSnapshot ||
          this.session.terminationVersionSnapshot !== version || this.auth.currentUser !== null)) {
        throw this.sessionChanged();
      }
    });
    return from(this.firebase.signInWithEmailLink(this.auth, email, link).finally(removeGuard)).pipe(
      map((credential: UserCredential) => {
        if (credential.user.uid !== uid || this.auth.currentUser?.uid !== uid ||
            this.session.isTerminatingSnapshot || this.session.terminationVersionSnapshot !== version ||
            credential.user.email?.toLowerCase() !== email.toLowerCase() || !credential.user.emailVerified) {
          throw this.sessionChanged();
        }
        return { uid, email };
      }),
      catchError(error => throwError(() => error?.code === 'auth/login-blocked' ? this.sessionChanged() : error)),
      finalize(() => { cancelled = true; }),
    );
  }

  private sessionChanged(): LocalError {
    return localError('registration/session-changed', 'A sessão mudou durante o cadastro. Confira a conta antes de continuar.');
  }

  private callable<Input, Result>(name: string) {
    return runInInjectionContext(this.injector, () => httpsCallable<Input, Result>(this.functions, name, {
      timeout: ACTION_TIMEOUT_MS,
    }));
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
        'O cadastro por link está indisponível neste endereço.');
    }
    return location.origin;
  }

  private reportAndRethrow(error: unknown, operation: string): Observable<never> {
    const diagnostic = error as (Partial<LocalError> & { details?: { reason?: string } }) | null;
    const knownRejection = EXPECTED_LINK_REJECTIONS.has(diagnostic?.details?.reason ?? diagnostic?.code ?? '');
    if (diagnostic?.localValidation !== true && !knownRejection) {
      try {
        // Nunca encaminhar detalhes que possam conter endereço, código ou senha.
        this.errors.report({ code: (error as { code?: string } | null)?.code }, {
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
