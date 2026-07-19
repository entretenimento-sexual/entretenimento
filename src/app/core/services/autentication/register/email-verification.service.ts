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
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import {
  ActionCodeSettings,
  User,
  applyActionCode,
  checkActionCode,
  sendEmailVerification,
} from 'firebase/auth';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap, timeout } from 'rxjs/operators';

import { IUserDados } from '../../../interfaces/iuser-dados';
import { environment } from 'src/environments/environment';
import { AuthSessionService } from '../auth/auth-session.service';
import { CurrentUserStoreService } from '../auth/current-user-store.service';
import { FirestoreUserWriteService } from '../../data-handling/firestore-user-write.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';

export type VerifyEmailReason =
  | 'expired'
  | 'invalid'
  | 'not-logged-in'
  | 'not-verified'
  | 'unknown';

export interface VerifyEmailResult {
  ok: boolean;
  firestoreUpdated?: boolean;
  reason?: VerifyEmailReason;
}

@Injectable({ providedIn: 'root' })
export class EmailVerificationService {
  private readonly NET_TIMEOUT_MS = 12_000;

  constructor(
    private readonly router: Router,
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly userWrite: FirestoreUserWriteService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService,
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
    return `${base}/post-verification/action`;
  }

  private buildActionCodeSettings(base?: string): ActionCodeSettings {
    const continueBase = base ?? this.preferredBaseUrl();
    const settings: ActionCodeSettings = {
      url: this.buildContinueUrl(continueBase),
      handleCodeInApp: true,
    };

    const config = environment as typeof environment & {
      dynamicLinkDomain?: string;
    };
    if (config.dynamicLinkDomain) {
      settings.dynamicLinkDomain = config.dynamicLinkDomain;
    }

    return settings;
  }

  reloadCurrentUser(): Observable<boolean> {
    return this.authSession.refreshCurrentUser$().pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      tap((user) => {
        if (user?.emailVerified === true) {
          this.currentUserStore.patch({ emailVerified: true });
        }
      }),
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
      ? ({ url: redirectUrl, handleCodeInApp: true } as ActionCodeSettings)
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
              this.reportError(
                fallbackError,
                'sendEmailVerificationFallback'
              );
              return throwError(() =>
                this.toVerificationError(fallbackError)
              );
            })
          );
        }

        this.reportError(error, 'sendEmailVerification');
        return throwError(() => this.toVerificationError(error));
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

    return from(applyActionCode(this.auth, safeCode)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      map(() => void 0),
      catchError((error: unknown) => {
        this.reportError(error, 'verifyEmail');
        return throwError(() => ({
          code: this.errorCode(error),
          message: this.mapErrorCodeToMessage(this.errorCode(error)),
        }));
      })
    );
  }

  handleEmailVerification(): Observable<VerifyEmailResult> {
    const tree = this.router.parseUrl(this.router.url || '');
    const queryParams = tree?.queryParams ?? {};
    const mode = String(queryParams['mode'] ?? '').trim() || null;
    const actionCode =
      String(queryParams['oobCode'] ?? '').trim() || null;

    if (mode && mode !== 'verifyEmail') {
      return of({ ok: false, reason: 'unknown' });
    }

    if (!actionCode) {
      return throwError(
        () => new Error('Código de verificação ausente na URL.')
      );
    }

    return from(checkActionCode(this.auth, actionCode)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      switchMap(() => this.verifyEmail(actionCode)),
      switchMap(() => {
        const currentUser = this.auth.currentUser;

        /**
         * SUPRESSÃO EXPLÍCITA:
         * o antigo patchEmailVerifiedByEmail$ foi removido deste fluxo. Sem uma
         * sessão autenticada, o navegador não pode listar users por e-mail nem
         * alterar um documento privado. A sincronização ocorrerá após o login.
         */
        if (!currentUser) {
          return of<VerifyEmailResult>({
            ok: true,
            firestoreUpdated: false,
            reason: 'not-logged-in',
          });
        }

        return this.authSession.refreshCurrentUser$().pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          switchMap((refreshed) => {
            if (!refreshed?.emailVerified) {
              return of<VerifyEmailResult>({
                ok: false,
                reason: 'not-verified',
              });
            }

            this.currentUserStore.patch({ emailVerified: true });

            return this.updateEmailVerificationStatus(
              refreshed.uid,
              true
            ).pipe(
              map(() => ({
                ok: true,
                firestoreUpdated: true,
              } as VerifyEmailResult)),
              catchError((error: unknown) => {
                this.reportError(
                  error,
                  'syncEmailVerificationAfterActionCode'
                );
                return of<VerifyEmailResult>({
                  ok: true,
                  firestoreUpdated: false,
                });
              })
            );
          })
        );
      }),
      catchError((error: unknown) => {
        this.reportError(error, 'handleEmailVerification');
        const code = this.errorCode(error);
        const reason: VerifyEmailReason =
          code === 'auth/expired-action-code'
            ? 'expired'
            : code === 'auth/invalid-action-code'
              ? 'invalid'
              : 'unknown';

        return of({ ok: false, reason });
      })
    );
  }

  updateEmailVerificationStatus(
    uid: string,
    status: boolean
  ): Observable<void> {
    return this.userWrite.patchEmailVerified$(uid, status).pipe(
      tap(() => {
        this.currentUserStore.patch({
          emailVerified: status === true,
        });
      }),
      catchError((error: unknown) => {
        this.notify.showError(
          'Não foi possível atualizar a verificação agora. Entre novamente e repita a conferência.'
        );
        this.reportError(error, 'updateEmailVerificationStatus', {
          uid,
        });
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
        `E-mail reenviado para ${user.email}. Verifique sua caixa de entrada.`
      ),
      catchError((error: unknown) => {
        this.reportError(error, 'resendVerificationEmail');
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
  ): void {
    try {
      const normalized =
        error instanceof Error
          ? error
          : new Error('[EmailVerificationService] operação falhou');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.original = error;
      contextual.context = {
        scope: 'EmailVerificationService',
        operation,
        ...extra,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Diagnóstico não interfere no fluxo de verificação.
    }
  }
}
