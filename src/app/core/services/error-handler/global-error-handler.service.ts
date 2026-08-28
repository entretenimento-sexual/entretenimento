// Serviço global de tratamento de erros
// Intercepta erros, formata mensagens para o usuário e loga detalhes para o desenvolvedor
// Em produção, não despeja erro bruto no console para evitar exposição de dados sensíveis.
import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { environment } from 'src/environments/environment';

import { ErrorNotificationService } from './error-notification.service';
import {
  isTransientNetworkError,
} from '../network/network-retry.policy';
import { NetworkStatusService } from '../network/network-status.service';

interface SanitizedErrorLog {
  name: string;
  message: string;
  code?: string;
  status?: number;
  statusText?: string;
  url?: string | null;
  feature?: string;
  operation?: string;
}

interface ErrorContextRecord {
  feature?: unknown;
  operation?: unknown;
  scope?: unknown;
  op?: unknown;
}

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandlerService implements ErrorHandler {
  private sentryInitialized = false;

  constructor(private injector: Injector) { }

  /**
   * Lida com erros globais da aplicação sem duplicar feedback já emitido por
   * handlers locais. O contexto técnico é sanitizado antes de log/monitoramento.
   */
  handleError(error: Error | HttpErrorResponse): void {
    const notifier = this.injector.get(ErrorNotificationService);

    this.logError(error);

    const userFacingMessage = this.formatErrorMessage(error);
    const details = this.extractDetails(error);
    const skipUserNotification =
      (error as any)?.skipUserNotification === true ||
      (error as any)?.silent === true;

    if (!skipUserNotification) {
      notifier.showError(userFacingMessage, details);
    }

    this.sendToExternalLoggingService(error);

    if (!environment.production && environment.enableDebugTools) {
      const original = (error as any)?.original;
      const meta = (error as any)?.meta;

      if (original) console.error('[GlobalErrorHandler] original error →', original);
      if (meta) console.warn('[GlobalErrorHandler] meta →', meta);
    }
  }

  /**
   * Mantém feedback de rede consistente e evita expor detalhes Firebase brutos.
   * Mensagens explicitamente marcadas como userFacingMessage podem ser usadas
   * por fluxos que precisam de orientação específica e segura.
   */
  public formatErrorMessage(error: Error | HttpErrorResponse): string {
    const networkStatus = this.injector.get(NetworkStatusService);

    if (!networkStatus.isOnlineSnapshot()) {
      return 'Você está offline. Verifique sua conexão com a internet.';
    }

    if (isTransientNetworkError(error)) {
      return 'O serviço está temporariamente indisponível. Tente novamente em instantes.';
    }

    const explicitUserMessage = this.safeString(
      (error as any)?.userFacingMessage
    );
    if (explicitUserMessage) {
      return explicitUserMessage;
    }

    if (error instanceof HttpErrorResponse) {
      return `Erro de rede (${error.status}). Por favor, tente novamente.`;
    }

    if (error instanceof TypeError) {
      return 'Ocorreu um problema na aplicação. Atualize a página e tente novamente.';
    }

    if (error instanceof SyntaxError) {
      return 'Ocorreu um erro na aplicação. Por favor, tente novamente mais tarde.';
    }

    return 'Ocorreu um erro inesperado. Por favor, tente novamente mais tarde.';
  }

  /**
   * Extrai detalhes apenas para o canal técnico do notifier. O
   * ErrorNotificationService não exibe `details` na interface.
   */
  private extractDetails(error: Error | HttpErrorResponse): string {
    const anyErr: any = error as any;

    if (typeof anyErr?.details === 'string' && anyErr.details.trim()) {
      return anyErr.details;
    }
    if (typeof anyErr?.code === 'string' && anyErr.code.trim()) {
      return anyErr.code;
    }

    if (error instanceof HttpErrorResponse) {
      if (
        typeof error.error?.message === 'string' &&
        error.error.message.trim()
      ) {
        return error.error.message;
      }
      if (typeof error.message === 'string' && error.message.trim()) {
        return error.message;
      }
      return `HTTP ${error.status}`;
    }

    if (
      typeof anyErr?.original?.message === 'string' &&
      anyErr.original.message.trim()
    ) {
      return anyErr.original.message;
    }
    if (
      typeof anyErr?.message === 'string' &&
      anyErr.message.trim()
    ) {
      return anyErr.message;
    }

    return '';
  }

  /**
   * Em produção não imprime objeto bruto. Em desenvolvimento com debug ativo,
   * preserva o erro completo para diagnóstico local.
   */
  private logError(error: Error | HttpErrorResponse): void {
    if (environment.production) {
      return;
    }

    if (environment.enableDebugTools) {
      console.error('Erro capturado pelo GlobalErrorHandler:', error);
      return;
    }

    console.warn(
      'Erro capturado pelo GlobalErrorHandler:',
      this.sanitizeError(error)
    );
  }

  private sendToExternalLoggingService(error: Error | HttpErrorResponse): void {
    if (!this.isCriticalError(error)) {
      return;
    }

    const sanitized = this.sanitizeError(error);

    if (!environment.production && environment.enableDebugTools) {
      console.warn('Erro crítico pronto para serviço externo:', sanitized);
    }

    void this.captureWithSentry(sanitized);
  }

  private isCriticalError(error: Error | HttpErrorResponse): boolean {
    if (error instanceof HttpErrorResponse) {
      return error.status >= 500;
    }
    return error instanceof TypeError || error instanceof SyntaxError;
  }

  private async captureWithSentry(sanitized: SanitizedErrorLog): Promise<void> {
    const sentry = environment.monitoring?.sentry;
    const dsn = String(sentry?.dsn ?? '').trim();

    if (sentry?.enabled !== true || !dsn) {
      return;
    }

    try {
      const Sentry = await import('@sentry/angular');

      if (!this.sentryInitialized) {
        Sentry.init({
          dsn,
          environment: environment.env,
          tracesSampleRate: Math.max(
            0,
            Math.min(Number(sentry.tracesSampleRate ?? 0), 1)
          ),
        });
        this.sentryInitialized = true;
      }

      Sentry.withScope((scope) => {
        scope.setTag('app_env', environment.env);
        if (sanitized.feature) scope.setTag('feature', sanitized.feature);
        if (sanitized.operation) scope.setTag('operation', sanitized.operation);
        if (sanitized.status) {
          scope.setTag('http_status', String(sanitized.status));
        }
        scope.setExtra('sanitized', sanitized);
        Sentry.captureException(
          new Error(`[${sanitized.name}] ${sanitized.message}`)
        );
      });
    } catch {
      // Falha do monitoramento nunca deve quebrar a UX.
    }
  }

  /**
   * Aceita o contrato moderno `context.feature/operation`, o legado
   * `context.scope/op` e, por compatibilidade, propriedades de topo.
   */
  private sanitizeError(error: Error | HttpErrorResponse): SanitizedErrorLog {
    const anyErr = error as any;
    const context = this.normalizeContext(anyErr?.context);
    const feature = this.safeString(
      anyErr?.feature ?? context?.feature ?? context?.scope
    );
    const operation = this.safeString(
      anyErr?.operation ?? context?.operation ?? context?.op
    );

    if (error instanceof HttpErrorResponse) {
      return {
        name: 'HttpErrorResponse',
        message: String(error.message ?? 'HTTP error').slice(0, 240),
        code: typeof anyErr?.code === 'string' ? anyErr.code : undefined,
        status: error.status,
        statusText: String(error.statusText ?? '').slice(0, 120),
        url: error.url ? String(error.url).slice(0, 240) : null,
        feature,
        operation,
      };
    }

    return {
      name: String(
        anyErr?.name || error?.constructor?.name || 'Error'
      ).slice(0, 120),
      message: String(anyErr?.message || 'Erro sem mensagem').slice(0, 240),
      code: this.safeString(anyErr?.code),
      feature,
      operation,
    };
  }

  private normalizeContext(value: unknown): ErrorContextRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as ErrorContextRecord
      : null;
  }

  private safeString(value: unknown): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized.slice(0, 120) : undefined;
  }
}
/*
src/app/core/services/error-handler/global-error-handler.service.ts
→ fallback “última linha” (erros não tratados)

src/app/core/services/error-handler/error-notification.service.ts
→ único ponto para notificar usuário (toast/snackbar/modal)

src/app/core/services/error-handler/firestore-error-handler.service.ts
→ padronizar erro do Firebase/Firestore (mapear codes, contextos)
*/
