// src/app/core/services/autentication/password-reset-code-validation.service.ts
// -----------------------------------------------------------------------------
// PASSWORD RESET CODE VALIDATION SERVICE
// -----------------------------------------------------------------------------
// - valida o oobCode antes de exibir o formulário de nova senha;
// - trata expiração e código inválido como estados esperados de produto;
// - encaminha falhas operacionais ao GlobalErrorHandlerService sem duplicar toast;
// - mantém contrato Observable-first e falha fechado.
// -----------------------------------------------------------------------------
import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { verifyPasswordResetCode } from 'firebase/auth';
import { Observable, of } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

export type PasswordResetCodeValidationReason =
  | 'valid'
  | 'expired'
  | 'invalid'
  | 'unavailable';

export interface PasswordResetCodeValidationResult {
  ok: boolean;
  reason: PasswordResetCodeValidationReason;
  email?: string;
  message: string;
}

export function mapPasswordResetCodeValidationError(
  error: unknown
): PasswordResetCodeValidationResult {
  const source = error as { code?: unknown; name?: unknown } | null;
  const code = String(source?.code ?? '').toLowerCase();

  if (code === 'auth/expired-action-code') {
    return {
      ok: false,
      reason: 'expired',
      message: 'O link de redefinição de senha expirou.',
    };
  }

  if (code === 'auth/invalid-action-code') {
    return {
      ok: false,
      reason: 'invalid',
      message: 'O código de redefinição é inválido ou já foi usado.',
    };
  }

  return {
    ok: false,
    reason: 'unavailable',
    message:
      source?.name === 'TimeoutError'
        ? 'A validação do link demorou além do esperado. Tente novamente.'
        : 'Não foi possível validar o link agora. Verifique sua conexão e tente novamente.',
  };
}

@Injectable({ providedIn: 'root' })
export class PasswordResetCodeValidationService {
  private readonly timeoutMs = 12_000;

  constructor(
    private readonly auth: Auth,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  validate$(oobCode: string): Observable<PasswordResetCodeValidationResult> {
    const safeCode = String(oobCode ?? '').trim();

    if (!safeCode) {
      return of({
        ok: false,
        reason: 'invalid',
        message: 'O link de redefinição é inválido ou está incompleto.',
      });
    }

    return this.ctx
      .deferPromise$(() => verifyPasswordResetCode(this.auth, safeCode))
      .pipe(
        timeout({ each: this.timeoutMs }),
        map((email) => ({
          ok: true,
          reason: 'valid' as const,
          email: String(email ?? '').trim().toLowerCase(),
          message: 'Link válido.',
        })),
        catchError((error: unknown) => {
          const result = mapPasswordResetCodeValidationError(error);

          if (result.reason === 'unavailable') {
            this.reportOperationalError(error, safeCode.length);
          }

          return of(result);
        })
      );
  }

  private reportOperationalError(error: unknown, codeLength: number): void {
    try {
      const normalized = new Error(
        '[PasswordResetCodeValidationService] Falha ao validar o link de redefinição.'
      ) as Error & {
        original?: unknown;
        context?: unknown;
        skipUserNotification?: boolean;
        silent?: boolean;
      };

      normalized.original = error;
      normalized.context = {
        scope: 'PasswordResetCodeValidationService',
        operation: 'validate$',
        codePresent: codeLength > 0,
      };
      normalized.skipUserNotification = true;
      normalized.silent = true;
      this.globalErrorHandler.handleError(normalized);
    } catch {
      // O diagnóstico secundário não pode alterar o fluxo de recuperação.
    }
  }
}
