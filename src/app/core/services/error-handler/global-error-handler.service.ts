// src/app/core/services/error-handler/global-error-handler.service.ts
// Serviço global de tratamento de erros
// Intercepta erros, formata mensagens para o usuário e loga detalhes para o desenvolvedor
// Não esquecer os comentários
import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorNotificationService } from './error-notification.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandlerService implements ErrorHandler {
  constructor(private injector: Injector) { }

  /**
   * Lida com erros globais na aplicação.
   * Intercepta erros, formata mensagens para o usuário e loga detalhes para o desenvolvedor.
   * @param error O erro capturado. Pode ser um Error, HttpErrorResponse, ou outro tipo.
   */
  handleError(error: Error | HttpErrorResponse): void {
    const notifier = this.injector.get(ErrorNotificationService);

    // 1) Log detalhado para dev (SUPERVALORIZADO)
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
   */
  private logError(error: Error | HttpErrorResponse): void {
    console.log('Erro capturado pelo GlobalErrorHandler:', error);
  }

  /**
   * Encaminha erros críticos para um serviço externo (Sentry/LogRocket).
   */
  private sendToExternalLoggingService(error: Error | HttpErrorResponse): void {
    if (this.isCriticalError(error)) {
      console.log('Enviando erro crítico para serviço externo:', error);
    }
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
