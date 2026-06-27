// src/app/core/services/error-handler/global-error-handler.service.ts
// Serviço global de tratamento de erros
// Intercepta erros, formata mensagens para o usuário e loga detalhes para o desenvolvedor
// Em produção, não despeja erro bruto no console para evitar exposição de dados sensíveis.
import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorNotificationService } from './error-notification.service';
import { environment } from 'src/environments/environment';

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

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandlerService implements ErrorHandler {
  private sentryInitialized = false;

  constructor(private injector: Injector) { }

  /**
   * Lida com erros globais na aplicação.
   * Intercepta erros, formata mensagens para o usuário e loga detalhes para o desenvolvedor.
   * @param error O erro capturado. Pode ser um Error, HttpErrorResponse, ou outro tipo.
   */
  handleError(error: Error | HttpErrorResponse): void {
    const notifier = this.injector.get(ErrorNotificationService);

    // 1) Log detalhado para dev, sanitizado/omitido em produção.
    this.logError(error);

    // 2) Mensagem para usuário
    const userFacingMessage = this.formatErrorMessage(error);

    // 3) Detalhes (para encaixar na assinatura showError(msg, details, ...))
    const details = this.extractDetails(error);

    // ✅ Evita duplicar toasts quando algum handler já notificou
    const skipUserNotification =
      (error as any)?.skipUserNotification === true ||
      (error as any)?.silent === true;

    if (!skipUserNotification) {
      // ✅ Corrige TS2554: showError exige 2-3 args no seu projeto
      notifier.showError(userFacingMessage, details);
    }

    // 4) Opcional: monitoramento externo
    this.sendToExternalLoggingService(error);

    if (!environment.production && environment.enableDebugTools) {
      const original = (error as any)?.original;
      const meta = (error as any)?.meta;

      if (original) console.error('[GlobalErrorHandler] original error →', original);
      if (meta) console.warn('[GlobalErrorHandler] meta →', meta);
    }
  }

  /**
   * Formata a mensagem de erro baseada no tipo de erro, priorizando mensagens amigáveis para o usuário.
   * Mantém o nome original 'formatErrorMessage'.
   */
  public formatErrorMessage(error: Error | HttpErrorResponse): string {
    // Prioriza mensagens já amigáveis
    if ((error as any)?.message && !(error as any)?.message.startsWith?.('[FirebaseError]')) {
      return (error as any).message;
    }

    if (error instanceof HttpErrorResponse) {
      if (!navigator.onLine) {
        return 'Você está offline. Verifique sua conexão com a internet.';
      }
      return error.error?.message || `Erro de rede (${error.status}). Por favor, tente novamente.`;
    }

    if (error instanceof TypeError) {
      return 'Ocorreu um problema de tipo na aplicação. Por favor, atualize a página e tente novamente.';
    }

    if (error instanceof SyntaxError) {
      return 'Ocorreu um erro na aplicação. Por favor, tente novamente mais tarde.';
    }

    return 'Ocorreu um erro inesperado. Por favor, tente novamente mais tarde.';
  }

  /**
   * Extrai detalhes opcionais para exibir no toast/snackbar, sem “poluir” o usuário.
   * Ajuda a satisfazer assinatura showError(msg, details).
   */
  private extractDetails(error: Error | HttpErrorResponse): string {
    // padrão do seu ecossistema: handlers podem anexar detalhes/original/code
    const anyErr: any = error as any;

    if (typeof anyErr?.details === 'string' && anyErr.details.trim()) return anyErr.details;
    if (typeof anyErr?.code === 'string' && anyErr.code.trim()) return anyErr.code;

    if (error instanceof HttpErrorResponse) {
      // tentar achar um detalhe útil
      if (typeof error.error?.message === 'string' && error.error.message.trim()) return error.error.message;
      if (typeof error.message === 'string' && error.message.trim()) return error.message;
      return `HTTP ${error.status}`;
    }

    if (typeof anyErr?.original?.message === 'string' && anyErr.original.message.trim()) return anyErr.original.message;
    if (typeof (error as any)?.message === 'string' && (error as any).message.trim()) return (error as any).message;

    return ''; // mantém compatível com showError(msg, details)
  }

  /**
   * Loga o erro no console de forma detalhada para o desenvolvedor.
   * Em produção, não imprime o objeto bruto. Isso evita vazar payloads, rotas,
   * contexto de Firebase, dados de usuário ou objetos anexados em `original`.
   */
  private logError(error: Error | HttpErrorResponse): void {
    if (environment.production) {
      return;
    }

    if (environment.enableDebugTools) {
      console.error('Erro capturado pelo GlobalErrorHandler:', error);
      return;
    }

    console.warn('Erro capturado pelo GlobalErrorHandler:', this.sanitizeError(error));
  }

  /**
   * Encaminha erros críticos para um serviço externo.
   * O envio real só ocorre se monitoring.sentry.enabled=true e dsn estiver configurado.
   * O payload enviado é sanitizado: sem `original`, stack, headers ou corpo bruto.
   */
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

  /**
   * Identifica se um erro é crítico.
   */
  private isCriticalError(error: Error | HttpErrorResponse): boolean {
    if (error instanceof HttpErrorResponse) {
      return error.status >= 500;
    }
    return error instanceof TypeError || error instanceof SyntaxError;
  }

  /**
   * Envia erro sanitizado ao Sentry quando explicitamente habilitado.
   * Mantém import dinâmico para não acoplar o boot ao monitoramento.
   */
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
          tracesSampleRate: Math.max(0, Math.min(Number(sentry.tracesSampleRate ?? 0), 1)),
        });
        this.sentryInitialized = true;
      }

      Sentry.withScope((scope) => {
        scope.setTag('app_env', environment.env);
        if (sanitized.feature) scope.setTag('feature', sanitized.feature);
        if (sanitized.operation) scope.setTag('operation', sanitized.operation);
        if (sanitized.status) scope.setTag('http_status', String(sanitized.status));
        scope.setExtra('sanitized', sanitized);
        Sentry.captureException(new Error(`[${sanitized.name}] ${sanitized.message}`));
      });
    } catch {
      // Não deixe falha do monitoramento quebrar UX nem loop de erro global.
    }
  }

  /**
   * Gera resumo seguro para logs e monitoramento.
   * Não inclui `original`, stack trace, payloads, headers nem dados sensíveis.
   */
  private sanitizeError(error: Error | HttpErrorResponse): SanitizedErrorLog {
    const anyErr = error as any;

    if (error instanceof HttpErrorResponse) {
      return {
        name: 'HttpErrorResponse',
        message: String(error.message ?? 'HTTP error').slice(0, 240),
        code: typeof anyErr?.code === 'string' ? anyErr.code : undefined,
        status: error.status,
        statusText: String(error.statusText ?? '').slice(0, 120),
        url: error.url ? String(error.url).slice(0, 240) : null,
        feature: this.safeString(anyErr?.feature),
        operation: this.safeString(anyErr?.operation),
      };
    }

    return {
      name: String(anyErr?.name || error?.constructor?.name || 'Error').slice(0, 120),
      message: String(anyErr?.message || 'Erro sem mensagem').slice(0, 240),
      code: this.safeString(anyErr?.code),
      feature: this.safeString(anyErr?.feature),
      operation: this.safeString(anyErr?.operation),
    };
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

Regra prática: em qualquer service com Observable, faça catchError(err => this.firestoreErrorHandler.handle$(...) ) e deixe o notifier centralizar UX.
*/