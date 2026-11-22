// src/app/core/services/autentication/register/email-verification.service.ts
// -----------------------------------------------------------------------------
// EMAIL VERIFICATION SERVICE
// -----------------------------------------------------------------------------
// - envia e aplica códigos de verificação do Firebase Auth;
// - sincroniza users/{uid}.emailVerified somente com sessão autenticada;
// - não enumera users por e-mail no navegador;
// - preserva os nomes públicos existentes.
// -----------------------------------------------------------------------------
import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  ActionCodeOperation,
  ActionCodeSettings,
  User,
  applyActionCode,
  checkActionCode,
  sendEmailVerification,
} from 'firebase/auth';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';

import { IUserDados } from '../../../interfaces/iuser-dados';
import { environment } from 'src/environments/environment';
import { AuthSessionService } from '../auth/auth-session.service';
import { FirestoreUserWriteService } from '../../data-handling/firestore-user-write.service';
import { ApplicationErrorService } from '../../error-handler/application-error.service';

export type VerifyEmailReason =
  | 'expired'
  | 'invalid'
  | 'not-logged-in'
  | 'different-account'
  | 'sync-pending'
  | 'unavailable'
  | 'not-verified'
  | 'unknown';

export interface VerifyEmailResult {
  ok: boolean;
  firestoreUpdated?: boolean;
  verifiedUid?: string;
  reason?: VerifyEmailReason;
}

@Injectable({ providedIn: 'root' })
export class EmailVerificationService {
  private readonly NET_TIMEOUT_MS = 12_000;
  private readonly reportedErrors = new WeakSet<object>();

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly userWrite: FirestoreUserWriteService,
    private readonly applicationError: ApplicationErrorService,
    private readonly auth: Auth
  ) {
    try {
      this.auth.languageCode = 'pt-BR';
    } catch {
      // Configuração de idioma não bloqueia a verificação.
    }
  }

  private isEmulator(): boolean {
    const config = environment as typeof environment & {
      useEmulators?: boolean;
      emulators?: { auth?: unknown };
    };
    return (
      !environment.production &&
      config.useEmulators === true &&
      !!config.emulators?.auth
    );
  }

  private isLocalHost(): boolean {
    if (typeof location === 'undefined') return false;
    return /^(localhost|127\.0\.0\.1|::1)$/.test(location.hostname);
  }

  private preferredBaseUrl(): string {
    const config = environment as typeof environment & {
      authActionHandlerBaseUrl?: string;
      appBaseUrl?: string;
    };

    if (
      this.isEmulator() &&
      typeof location !== 'undefined' &&
      location.origin
    ) {
      return location.origin;
    }

    const configured =
      config.authActionHandlerBaseUrl || config.appBaseUrl;
    if (configured) return String(configured);

    if (
      this.isLocalHost() &&
      typeof location !== 'undefined' &&
      location.origin
    ) {
      return location.origin;
    }

    if (typeof location !== 'undefined' && location.origin) {
      return location.origin;
    }

    return `https://${environment.firebase.authDomain}`;
  }

  private safeBaseUrl(): string {
    if (
      this.isEmulator() &&
      typeof location !== 'undefined' &&
      location.origin
    ) {
      return location.origin;
    }

    return `https://${environment.firebase.authDomain}`;
  }

  private buildContinueUrl(base: string): string {
    return `${base}/register/welcome?autocheck=1`;
  }

  private buildActionCodeSettings(base?: string): ActionCodeSettings {
    const continueBase = base ?? this.preferredBaseUrl();
    return {
      url: this.buildContinueUrl(continueBase),
      handleCodeInApp: !this.isEmulator(),
    };
  }

  reloadCurrentUser(): Observable<boolean> {
    return this.authSession.refreshCurrentUser$({ requireFresh: true }).pipe(
      timeout({ first: this.NET_TIMEOUT_MS }),
      map((user) => user?.emailVerified === true),
      catchError((error: unknown) => {
        this.reportError(error, 'reloadCurrentUser');
        return of(false);
      })
    );
  }

  sendEmailVerification(
    user: User,
    redirectUrl?: string
  ): Observable<void> {
    const primarySettings = redirectUrl
      ? { url: redirectUrl, handleCodeInApp: !this.isEmulator() }
      : this.buildActionCodeSettings();
    const fallbackSettings = this.buildActionCodeSettings(
      this.safeBaseUrl()
    );

    return from(sendEmailVerification(user, primarySettings)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      map(() => void 0),
      catchError((error: unknown) => {
        const code = this.errorCode(error);

        if (
          code === 'auth/unauthorized-domain' ||
          code === 'auth/invalid-continue-uri'
        ) {
          return from(
            sendEmailVerification(user, fallbackSettings)
          ).pipe(
            timeout({ each: this.NET_TIMEOUT_MS }),
            map(() => void 0),
            catchError((fallbackError: unknown) => {
              const mapped = this.toVerificationError(fallbackError);
              const reported = this.reportError(
                fallbackError,
                'sendEmailVerificationFallback'
              );

              if (reported) {
                this.markReported(mapped);
              }

              return throwError(() => mapped);
            })
          );
        }

        const mapped = this.toVerificationError(error);
        const reported = this.reportError(error, 'sendEmailVerification');

        if (reported) {
          this.markReported(mapped);
        }

        return throwError(() => mapped);
      })
    );
  }

  verifyEmail(actionCode: string): Observable<void> {
    const safeCode = String(actionCode ?? '').trim();
    if (!safeCode) {
      return throwError(
        () => new Error('Código de verificação ausente.')
      );
    }

    return defer(() => applyActionCode(this.auth, safeCode)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      map(() => void 0),
      catchError((error: unknown) => {
        const mapped = {
          code: this.errorCode(error),
          message: this.mapErrorCodeToMessage(this.errorCode(error)),
        };
        const reported = this.reportError(error, 'verifyEmail');

        if (reported) {
          this.markReported(mapped);
        }

        return throwError(() => mapped);
      })
    );
  }

  handleEmailVerification(code: string): Observable<VerifyEmailResult> {
    const actionCode = code.trim();
    if (!actionCode) return of({ ok: false, reason: 'invalid' });

    return defer(() => {
      const initialUser = this.auth.currentUser;
      const termination = this.authSession.terminationVersionSnapshot;
      const isSameSession = () => this.auth.currentUser === initialUser &&
        this.authSession.terminationVersionSnapshot === termination &&
        !this.authSession.isTerminatingSnapshot;

      return defer(() => this.checkVerificationCode(actionCode)).pipe(
        timeout({ first: this.NET_TIMEOUT_MS }),
        switchMap(({ operation, data }) => {
          const recipient = data.email?.trim().toLowerCase();
          if (operation !== ActionCodeOperation.VERIFY_EMAIL || !recipient) {
            return of<VerifyEmailResult>({ ok: false, reason: 'invalid' });
          }

          const matchesRecipient = () => isSameSession() &&
            initialUser?.email?.trim().toLowerCase() === recipient;
          const verifiedWithoutMatchingSession = (): VerifyEmailResult => ({
            ok: true,
            firestoreUpdated: false,
            reason: this.auth.currentUser ? 'different-account' : 'not-logged-in',
          });

          return this.verifyEmail(actionCode).pipe(
            switchMap(() => {
              if (!initialUser || !matchesRecipient()) {
                return of(verifiedWithoutMatchingSession());
              }

              return this.authSession.refreshCurrentUser$({ requireFresh: true }).pipe(
                switchMap((refreshed) => {
                  if (!matchesRecipient() || refreshed !== initialUser || !refreshed.emailVerified) {
                    return of(false);
                  }
                  return this.updateEmailVerificationStatus(refreshed.uid, true).pipe(map(() => true));
                }),
                timeout({ first: this.NET_TIMEOUT_MS }),
                catchError((error: unknown) => {
                  this.reportErrorIfNeeded(error, 'syncEmailVerificationAfterActionCode');
                  return of(false);
                }),
                map((firestoreUpdated): VerifyEmailResult => {
                  if (!matchesRecipient()) return verifiedWithoutMatchingSession();
                  return {
                    ok: true,
                    firestoreUpdated,
                    verifiedUid: initialUser.uid,
                    ...(firestoreUpdated ? {} : { reason: 'sync-pending' }),
                  };
                })
              );
            })
          );
        }),
        catchError((error: unknown) => {
          this.reportErrorIfNeeded(error, 'handleEmailVerification');
          const code = this.errorCode(error);
          const reason = code === 'auth/expired-action-code' ? 'expired'
            : code === 'auth/invalid-action-code' ? 'invalid'
            : 'unavailable';
          return of<VerifyEmailResult>({ ok: false, reason });
        })
      );
    });
  }

  private checkVerificationCode(actionCode: string) {
    return checkActionCode(this.auth, actionCode);
  }

  updateEmailVerificationStatus(uid: string, status: boolean): Observable<void> {
    return defer(() => {
      const active = this.auth.currentUser;
      if (active?.uid !== uid || active.emailVerified !== status || this.authSession.isTerminatingSnapshot) {
        throw new Error('A sessão atual não confirma este estado de e-mail.');
      }
      return this.userWrite.patchEmailVerified$(uid, status);
    }).pipe(
      catchError((error: unknown) => {
        this.reportErrorIfNeeded(error, 'updateEmailVerificationStatus', { uid });
        return throwError(() => error);
      })
    );
  }

  saveUserDataAfterEmailVerification(
    user: IUserDados
  ): Observable<void> {
    return this.userWrite.saveUserDataAfterEmailVerification$(user);
  }

  getCurrentUserUid(): Observable<string | null> {
    return of(this.auth.currentUser?.uid ?? null);
  }

  resendVerificationEmail(
    redirectUrl?: string
  ): Observable<string> {
    const user = this.auth.currentUser;
    if (!user) {
      return throwError(
        () => new Error('Nenhum usuário autenticado encontrado.')
      );
    }

    return this.sendEmailVerification(user, redirectUrl).pipe(
      map(() =>
        `E-mail reenviado. Verifique sua caixa de entrada.`
      ),
      catchError((error: unknown) => {
        this.reportErrorIfNeeded(error, 'resendVerificationEmail');

        return throwError(
          () => new Error('Erro ao reenviar e-mail de verificação.')
        );
      })
    );
  }

  private errorCode(error: unknown): string {
    return String(
      (error as { code?: unknown } | null)?.code ?? ''
    );
  }

  private toVerificationError(error: unknown): {
    code: string;
    message: string;
  } {
    const code = this.errorCode(error) || 'email-verification-failed';
    return {
      code,
      message:
        code === 'deadline-exceeded'
          ? 'Tempo de resposta excedido ao enviar o e-mail. Tente novamente.'
          : 'Não foi possível enviar o e-mail de verificação.',
    };
  }

  private mapErrorCodeToMessage(code?: string): string {
    switch (code) {
      case 'auth/expired-action-code':
        return 'O link expirou. Solicite um novo.';
      case 'auth/invalid-action-code':
        return 'O link é inválido. Solicite um novo.';
      default:
        return 'Erro ao verificar o e-mail.';
    }
  }

  private reportError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown> = {}
  ): boolean {
    try {
      this.applicationError.report(error, {
        feature: 'email-verification',
        operation,
        fallbackMessage: 'Não foi possível concluir uma etapa interna da verificação de e-mail.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'EmailVerificationService',
          operation,
          ...extra,
        },
      });

      return true;
    } catch {
      // Diagnóstico não interfere no fluxo de verificação.
      return false;
    }
  }

  private reportErrorIfNeeded(
    error: unknown,
    operation: string,
    extra: Record<string, unknown> = {}
  ): void {
    if (this.wasReported(error)) {
      return;
    }

    if (this.reportError(error, operation, extra)) {
      this.markReported(error);
    }
  }

  private markReported(error: unknown): void {
    if (
      (typeof error === 'object' && error !== null) ||
      typeof error === 'function'
    ) {
      this.reportedErrors.add(error as object);
    }
  }

  private wasReported(error: unknown): boolean {
    return (
      ((typeof error === 'object' && error !== null) ||
        typeof error === 'function') &&
      this.reportedErrors.has(error as object)
    );
  }
}
