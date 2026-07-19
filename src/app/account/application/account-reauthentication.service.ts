// src/app/account/application/account-reauthentication.service.ts
// -----------------------------------------------------------------------------
// ACCOUNT REAUTHENTICATION SERVICE
// -----------------------------------------------------------------------------
// - confirma a identidade antes de ações sensíveis do lifecycle;
// - usa senha quando o provedor password está vinculado;
// - usa Google quando esse é o provedor disponível;
// - força renovação do ID token depois da reautenticação;
// - falha fechado para provedores ainda não suportados.
// -----------------------------------------------------------------------------
import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  getIdToken,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth';
import { Observable, defer, throwError } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AccountReauthenticationMode } from '../models/account-lifecycle.model';

const REAUTHENTICATION_TIMEOUT_MS = 30_000;

export function resolveAccountReauthenticationMode(
  providerIds: readonly string[]
): AccountReauthenticationMode {
  const normalized = new Set(
    providerIds.map((providerId) => String(providerId ?? '').trim())
  );

  if (normalized.has('password')) return 'password';
  if (normalized.has('google.com')) return 'google';
  return 'unsupported';
}

@Injectable({ providedIn: 'root' })
export class AccountReauthenticationService {
  private readonly auth = inject(Auth);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notify = inject(ErrorNotificationService);

  getCurrentMode(): AccountReauthenticationMode {
    const user = this.auth.currentUser;
    if (!user) return 'unsupported';

    return resolveAccountReauthenticationMode(
      (user.providerData ?? []).map((provider) => provider.providerId)
    );
  }

  reauthenticateForSensitiveAction$(
    password?: string | null
  ): Observable<void> {
    const user = this.auth.currentUser;

    if (!user) {
      return this.failClosed$(
        'Sua sessão terminou. Entre novamente para continuar.',
        'auth/unauthenticated'
      );
    }

    const mode = this.getCurrentMode();
    const reauthentication$ = this.buildReauthentication$(
      user,
      mode,
      password
    );

    return reauthentication$.pipe(
      timeout({ first: REAUTHENTICATION_TIMEOUT_MS }),
      switchMap(() =>
        this.runFirebaseOperation$(() => getIdToken(user, true))
      ),
      timeout({ first: REAUTHENTICATION_TIMEOUT_MS }),
      map(() => void 0),
      catchError((error: unknown) => {
        this.report(error, mode);
        this.notify.showError(this.resolveUserMessage(error));
        return throwError(() => error);
      })
    );
  }

  private buildReauthentication$(
    user: User,
    mode: AccountReauthenticationMode,
    password?: string | null
  ): Observable<unknown> {
    if (mode === 'password') {
      const safePassword = String(password ?? '');

      if (!user.email) {
        return this.failClosed$(
          'Não foi possível localizar o e-mail desta conta para confirmar a identidade.',
          'auth/email-unavailable'
        );
      }

      if (!safePassword) {
        return this.failClosed$(
          'Informe sua senha atual para confirmar esta ação.',
          'validation/password-required'
        );
      }

      const credential = EmailAuthProvider.credential(
        user.email,
        safePassword
      );

      return this.runFirebaseOperation$(() =>
        reauthenticateWithCredential(user, credential)
      );
    }

    if (mode === 'google') {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      return this.runFirebaseOperation$(() =>
        reauthenticateWithPopup(user, provider)
      );
    }

    return this.failClosed$(
      'O provedor desta conta ainda não possui confirmação segura nesta versão.',
      'auth/reauthentication-provider-unsupported'
    );
  }

  private runFirebaseOperation$<T>(operation: () => Promise<T>): Observable<T> {
    return defer(() =>
      runInInjectionContext(this.envInjector, () => operation())
    );
  }

  private failClosed$<T>(message: string, code: string): Observable<T> {
    const error = new Error(message) as Error & {
      code?: string;
      skipUserNotification?: boolean;
    };
    error.code = code;
    error.skipUserNotification = true;

    this.report(error, this.getCurrentMode());
    this.notify.showError(message);
    return throwError(() => error);
  }

  private resolveUserMessage(error: unknown): string {
    const code = String(
      (error as { code?: unknown } | null)?.code ?? ''
    ).toLowerCase();

    if (
      code.includes('wrong-password') ||
      code.includes('invalid-credential') ||
      code.includes('invalid-login-credentials')
    ) {
      return 'A senha informada não confere.';
    }

    if (code.includes('user-mismatch')) {
      return 'Confirme com a mesma conta Google vinculada ao seu perfil.';
    }

    if (
      code.includes('popup-closed-by-user') ||
      code.includes('cancelled-popup-request')
    ) {
      return 'A confirmação com Google foi cancelada.';
    }

    if (code.includes('popup-blocked')) {
      return 'O navegador bloqueou a confirmação com Google. Libere pop-ups e tente novamente.';
    }

    if (code.includes('too-many-requests')) {
      return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';
    }

    if (code.includes('network-request-failed')) {
      return 'Falha de conexão durante a confirmação. Verifique sua internet e tente novamente.';
    }

    if (code.includes('unauthenticated')) {
      return 'Sua sessão terminou. Entre novamente para continuar.';
    }

    if (code.includes('provider-unsupported')) {
      return 'O provedor desta conta ainda não possui confirmação segura nesta versão.';
    }

    return 'Não foi possível confirmar sua identidade agora.';
  }

  private report(
    error: unknown,
    mode: AccountReauthenticationMode
  ): void {
    try {
      const normalized =
        error instanceof Error
          ? error
          : new Error('[AccountReauthenticationService] operation failed');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: unknown;
        skipUserNotification?: boolean;
        silent?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'AccountReauthenticationService',
        operation: 'reauthenticateForSensitiveAction$',
        mode,
      };
      contextual.skipUserNotification = true;
      contextual.silent = true;

      this.globalError.handleError(contextual);
    } catch {
      // Diagnóstico secundário não altera a falha principal.
    }
  }
}
