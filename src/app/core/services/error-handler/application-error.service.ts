// src/app/core/services/error-handler/application-error.service.ts
// -----------------------------------------------------------------------------
// APPLICATION ERROR SERVICE
// -----------------------------------------------------------------------------
// Camada canônica entre erros de transporte/domínio e a experiência do usuário.
//
// Responsabilidades:
// - normalizar códigos de Firebase/Functions sem expor mensagens técnicas;
// - extrair `reason` e `recommendedAction` de detalhes estruturados;
// - resolver mensagens seguras por código ou motivo de domínio;
// - indicar se a falha pode ser tentada novamente;
// - delegar feedback visual ao ErrorNotificationService;
// - delegar diagnóstico sanitizado ao GlobalErrorHandlerService.
//
// O serviço não substitui regras de negócio e não confia em `error.message` como
// texto de interface. Mensagens específicas devem ser declaradas pelo chamador
// por código/motivo, mantendo a tradução do domínio testável e previsível.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';

import { ErrorNotificationService } from './error-notification.service';
import { GlobalErrorHandlerService } from './global-error-handler.service';

type UnknownRecord = Record<string, unknown>;

export type ApplicationErrorNotification =
  | 'error'
  | 'warning'
  | 'info'
  | 'none';

export interface ApplicationErrorDescriptor {
  readonly code: string | null;
  readonly reason: string | null;
  readonly recommendedAction: string | null;
  readonly userMessage: string;
  readonly retryable: boolean;
}

export interface ApplicationErrorReportOptions {
  readonly feature: string;
  readonly operation: string;
  readonly fallbackMessage: string;
  readonly notification?: ApplicationErrorNotification;
  readonly codeMessages?: Readonly<Record<string, string>>;
  readonly reasonMessages?: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const COMMON_CODE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  unauthenticated: 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/user-token-expired': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/requires-recent-login': 'Confirme sua identidade novamente para continuar.',
  'permission-denied': 'Sua conta não tem permissão para realizar esta ação.',
  'not-found': 'O conteúdo solicitado não está mais disponível.',
  'already-exists': 'Esta ação já foi concluída ou o conteúdo já existe.',
  'resource-exhausted': 'Muitas solicitações foram feitas em pouco tempo. Tente novamente mais tarde.',
  'failed-precondition': 'Esta ação não está disponível nas condições atuais.',
  'invalid-argument': 'Revise os dados informados e tente novamente.',
  'deadline-exceeded': 'A operação demorou mais que o esperado. Tente novamente.',
  unavailable: 'O serviço está temporariamente indisponível. Tente novamente em instantes.',
  aborted: 'A operação encontrou um conflito temporário. Tente novamente.',
  cancelled: 'A operação foi interrompida antes de ser concluída.',
  'out-of-range': 'Um dos valores informados está fora do limite permitido.',
  unimplemented: 'Esta funcionalidade ainda não está disponível.',
  'data-loss': 'Não foi possível validar a integridade dos dados recebidos.',
  internal: 'O serviço encontrou um erro interno. Tente novamente mais tarde.',
  unknown: 'Não foi possível concluir a ação agora. Tente novamente.',
});

const RETRYABLE_CODES = new Set([
  'resource-exhausted',
  'deadline-exceeded',
  'unavailable',
  'aborted',
  'cancelled',
  'internal',
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function safeString(value: unknown, maxLength = 160): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeTransportCode(value: unknown): string | null {
  const rawCode = safeString(value);
  if (!rawCode) return null;

  return rawCode
    .replace(/^functions\//, '')
    .replace(/^firestore\//, '');
}

function safeMessage(value: unknown, fallback: string): string {
  const normalized = safeString(value, 280);
  return normalized ?? fallback;
}

@Injectable({ providedIn: 'root' })
export class ApplicationErrorService {
  private readonly notifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  normalize(
    error: unknown,
    options: ApplicationErrorReportOptions
  ): ApplicationErrorDescriptor {
    const source = asRecord(error);
    const details = asRecord(source?.['details']);
    const code = normalizeTransportCode(source?.['code']);
    const reason = safeString(
      details?.['reason'] ?? source?.['reason']
    );
    const recommendedAction = safeString(
      details?.['recommendedAction'] ?? source?.['recommendedAction']
    );
    const fallbackMessage = safeMessage(
      options.fallbackMessage,
      'Não foi possível concluir a ação agora.'
    );
    const userMessage =
      (reason ? safeString(options.reasonMessages?.[reason], 280) : null)
      ?? (code ? safeString(options.codeMessages?.[code], 280) : null)
      ?? (code ? COMMON_CODE_MESSAGES[code] : null)
      ?? fallbackMessage;

    return {
      code,
      reason,
      recommendedAction,
      userMessage,
      retryable: code ? RETRYABLE_CODES.has(code) : false,
    };
  }

  report(
    error: unknown,
    options: ApplicationErrorReportOptions
  ): ApplicationErrorDescriptor {
    const descriptor = this.normalize(error, options);

    this.notify(descriptor.userMessage, options.notification ?? 'error');
    this.reportTechnicalError(error, descriptor, options);

    return descriptor;
  }

  private notify(
    message: string,
    notification: ApplicationErrorNotification
  ): void {
    try {
      switch (notification) {
        case 'error':
          this.notifier.showError(message);
          return;
        case 'warning':
          this.notifier.showWarning(message);
          return;
        case 'info':
          this.notifier.showInfo(message);
          return;
        case 'none':
          return;
      }
    } catch {
      // A observabilidade técnica abaixo continua independente do feedback visual.
    }
  }

  private reportTechnicalError(
    original: unknown,
    descriptor: ApplicationErrorDescriptor,
    options: ApplicationErrorReportOptions
  ): void {
    try {
      const diagnostic = new Error(
        `Falha em ${options.feature}/${options.operation}.`
      ) as Error & {
        code?: string;
        reason?: string;
        recommendedAction?: string;
        original?: unknown;
        context?: Readonly<Record<string, unknown>>;
        skipUserNotification?: boolean;
        userFacingMessage?: string;
      };

      diagnostic.name = 'ApplicationError';
      if (descriptor.code) diagnostic.code = descriptor.code;
      if (descriptor.reason) diagnostic.reason = descriptor.reason;
      if (descriptor.recommendedAction) {
        diagnostic.recommendedAction = descriptor.recommendedAction;
      }
      diagnostic.original = original;
      diagnostic.context = {
        feature: options.feature,
        operation: options.operation,
        ...(options.metadata ?? {}),
      };
      diagnostic.userFacingMessage = descriptor.userMessage;
      diagnostic.skipUserNotification = true;

      this.globalError.handleError(diagnostic);
    } catch {
      // Falha do pipeline de diagnóstico nunca deve interromper a UX.
    }
  }
}
