// src\app\core\services\error-handler\global-error-handler.service.ts
import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorNotificationService } from './error-notification.service';

@Injectable({
  providedIn: 'root'
})
export class GlobalErrorHandlerService implements ErrorHandler {
  constructor(private injector: Injector) { }

  handleError(error: Error | HttpErrorResponse): void {
    const notifier = this.injector.get(ErrorNotificationService);

    // Formatar a mensagem de erro
    const errorMessage = this.formatErrorMessage(error);

    // Exibir notificação de erro para o usuário
    notifier.showError(errorMessage);

    // Logar o erro no console e, opcionalmente, em um serviço externo
    this.logError(error);

    // Opcional: Encaminhar erros críticos para serviços externos
    this.sendToExternalLoggingService(error);
  }

  /**
   * Formata a mensagem de erro baseada no tipo de erro
   */
  private formatErrorMessage(error: Error | HttpErrorResponse): string {
    if (error instanceof HttpErrorResponse) {
      if (!navigator.onLine) {
        return 'Você está offline. Verifique sua conexão com a internet.';
      }
      return `Erro de rede (${error.status}): ${error.error?.message || error.message}`;
    } else if (error instanceof TypeError) {
      return `Erro de tipo: ${error.message}`;
    } else if (error instanceof SyntaxError) {
      return `Erro de sintaxe: ${error.message}`;
    } else if ((error as any).userFriendlyMessage) {
      return (error as any).userFriendlyMessage; // Mensagem amigável definida no erro
    } else {
      return `Erro inesperado: ${error.message || 'Erro desconhecido'}`;
    }
  }

  /**
   * Loga o erro no console e, opcionalmente, integra com serviços externos
   */
  private logError(error: Error | HttpErrorResponse): void {
    console.log('Erro capturado pelo GlobalErrorHandler:', error);

    // Integre com um serviço de logging externo (opcional)
    // Exemplo: Envio para Sentry
    // const sentryService = this.injector.get(SentryService);
    // sentryService.logError(error);
  }

  /**
   * Encaminha erros críticos para um serviço externo, como Sentry ou LogRocket
   * (Opcional, dependendo da arquitetura do projeto)
   */
  private sendToExternalLoggingService(error: Error | HttpErrorResponse): void {
    // Verifique se é um erro crítico antes de enviar
    if (this.isCriticalError(error)) {
      console.log('Enviando erro crítico para serviço externo:', error);

      // Exemplo: Integração com um serviço externo
      // const loggingService = this.injector.get(ExternalLoggingService);
      // loggingService.logError(error);
    }
  }

  /**
   * Identifica se o erro é crítico (opcional, ajustável de acordo com o projeto)
   */
  private isCriticalError(error: Error | HttpErrorResponse): boolean {
    // Exemplo de regra para erros críticos: status 500 ou erros do sistema
    if (error instanceof HttpErrorResponse) {
      return error.status >= 500;
    }
    return error instanceof TypeError || error instanceof SyntaxError;
  }
}
