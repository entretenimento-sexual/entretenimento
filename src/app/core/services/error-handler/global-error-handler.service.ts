// src/app/core/services/error-handler/global-error-handler.service.ts
import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorNotificationService } from './error-notification.service';

@Injectable({
  providedIn: 'root'
})
export class GlobalErrorHandlerService implements ErrorHandler {
  constructor(private injector: Injector) { }

  /**
   * Lida com erros globais na aplicação.
   * Intercepta erros, formata mensagens para o usuário e loga detalhes para o desenvolvedor.
   * @param error O erro capturado. Pode ser um Error, HttpErrorResponse, ou outro tipo.
   */
  handleError(error: Error | HttpErrorResponse): void {
    const notifier = this.injector.get(ErrorNotificationService);

    // 1. Loga o erro no console de forma detalhada para o desenvolvedor (SUPERVALORIZADO)
    this.logError(error);

    // 2. Formata a mensagem de erro para ser exibida ao usuário (SUPERVALORIZADO FEEDBACK)
    // Mantemos o nome original do método 'formatErrorMessage'
    const userFacingMessage = this.formatErrorMessage(error);

    // 3. Exibe a notificação de erro para o usuário através do ErrorNotificationService
    notifier.showError(userFacingMessage);

    // 4. Opcional: Encaminha erros críticos para serviços de logging externos
    this.sendToExternalLoggingService(error);
  }

  /**
   * Formata a mensagem de erro baseada no tipo de erro, priorizando mensagens amigáveis para o usuário.
   * Este método mantém o nome original 'formatErrorMessage'.
   * @param error O erro original.
   * @returns Uma string com a mensagem amigável para o usuário.
   */
  private formatErrorMessage(error: Error | HttpErrorResponse): string {
    // Prioriza mensagens de erro que já são amigáveis ao usuário.
    // Isso é crucial para erros que vêm de serviços como RegisterService,
    // que já formatam a mensagem para o usuário antes de lançar o erro.
    // A condição '!error.message.startsWith('[FirebaseError]'))' é um exemplo para evitar
    // mensagens Firebase cruas, mas pode ser ajustada conforme a necessidade.
    if (error.message && !error.message.startsWith('[FirebaseError]')) {
      return error.message;
    }

    if (error instanceof HttpErrorResponse) {
      if (!navigator.onLine) {
        return 'Você está offline. Verifique sua conexão com a internet.';
      }
      // Se houver uma mensagem de erro na resposta da API, use-a.
      // Caso contrário, fornece uma mensagem genérica de erro de rede.
      return error.error?.message || `Erro de rede (${error.status}). Por favor, tente novamente.`;
    } else if (error instanceof TypeError) {
      // Mensagem mais amigável para erros de tipo, sugerindo uma ação ao usuário.
      return `Ocorreu um problema de tipo na aplicação. Por favor, atualize a página e tente novamente.`;
    } else if (error instanceof SyntaxError) {
      // Mensagem mais amigável para erros de sintaxe.
      return `Ocorreu um erro na aplicação. Por favor, tente novamente mais tarde.`;
    } else {
      // Mensagem genérica para outros erros não tratados explicitamente.
      return 'Ocorreu um erro inesperado. Por favor, tente novamente mais tarde.';
    }
  }

  /**
   * Loga o erro no console de forma detalhada para o desenvolvedor.
   * Usa `console.error` para destacar a importância do log.
   * @param error O erro a ser logado.
   */
  private logError(error: Error | HttpErrorResponse): void {
    console.log('Erro capturado pelo GlobalErrorHandler:', error);
    // Integre aqui com um serviço de logging externo (opcional)
    // Exemplo: const sentryService = this.injector.get(SentryService);
    // sentryService.logError(error);
  }

  /**
   * Encaminha erros considerados críticos para um serviço externo de monitoramento,
   * como Sentry ou LogRocket.
   * @param error O erro a ser avaliado e potencialmente enviado.
   */
  private sendToExternalLoggingService(error: Error | HttpErrorResponse): void {
    // Implemente a lógica para verificar se o erro é crítico antes de enviar.
    if (this.isCriticalError(error)) {
      console.log('Enviando erro crítico para serviço externo:', error);
      // Exemplo: const loggingService = this.injector.get(ExternalLoggingService);
      // loggingService.logError(error);
    }
  }

  /**
   * Identifica se um erro é crítico, baseado em regras definidas pelo projeto.
   * @param error O erro a ser verificado.
   * @returns `true` se o erro for crítico, `false` caso contrário.
   */
  private isCriticalError(error: Error | HttpErrorResponse): boolean {
    // Exemplo de regra para erros críticos: status 500 em HTTP ou erros fundamentais do sistema.
    if (error instanceof HttpErrorResponse) {
      return error.status >= 500;
    }
    return error instanceof TypeError || error instanceof SyntaxError;
  }
}
