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

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import type { AccountReauthenticationMode } from '../models/account-lifecycle.model';

const REAUTHENTICATION_TIMEOUT_MS = 30_000;

const REAUTHENTICATION_CODE_MESSAGES: Readonly<Record<string, string>> =
  Object.freeze({
    'auth/wrong-password': 'A senha informada não confere.',
    'auth/invalid-credential': 'A senha informada não confere.',
    'auth/invalid-login-credentials': 'A senha informada não confere.',
    'validation/password-required':
      'Informe sua senha atual para confirmar esta ação.',
    'auth/email-unavailable':
      'Não foi possível localizar o e-mail desta conta para confirmar a identidade.',
    'auth/user-mismatch':
      'Confirme com a mesma conta Google vinculada ao seu perfil.',
    'auth/popup-closed-by-user':
      'A confirmação com Google foi cancelada.',
    'auth/cancelled-popup-request':
      'A confirmação com Google foi cancelada.',
    'auth/popup-blocked':
      'O navegador bloqueou a confirmação com Google. Libere pop-ups e tente novamente.',
    'auth/too-many-requests':
      'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
    'auth/network-request-failed':
      'Falha de conexão durante a confirmação. Verifique sua internet e tente novamente.',
    'auth/unauthenticated':
      'Sua sessão terminou. Entre novamente para continuar.',
    'auth/reauthentication-provider-unsupported':
      'O provedor desta conta ainda não possui confirmação segura nesta versão.',
  });

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
  private readonly applicationError = inject(ApplicationErrorService);

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
        this.applicationError.report(error, {
          feature: 'account-reauthentication',
          operation: 'reauthenticateForSensitiveAction$',
          fallbackMessage: 'Não foi possível confirmar sua identidade agora.',
          codeMessages: REAUTHENTICATION_CODE_MESSAGES,
          metadata: {
            scope: 'AccountReauthenticationService',
            mode,
          },
        });
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
    return throwError(() => error);
  }

}
