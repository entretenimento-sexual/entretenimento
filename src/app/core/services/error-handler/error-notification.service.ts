// src/app/core/services/error-handler/error-notification.service.ts
// -----------------------------------------------------------------------------
// ERROR NOTIFICATION SERVICE
// -----------------------------------------------------------------------------
//
// Ponto central de feedback visual curto para o usuário.
//
// Responsabilidade:
// - exibir snackbars de sucesso, erro, informação e aviso;
// - evitar mensagens repetidas em curto intervalo;
// - preservar API atual utilizada em vários módulos da aplicação;
// - impedir exposição de detalhes técnicos, stack traces ou mensagens internas
//   vindas de Firebase, Functions, Storage, billing ou moderação.
//
// Segurança:
// - `details` permanece na assinatura apenas por compatibilidade;
// - `details` nunca é exibido em alerta, modal ou snackbar;
// - detalhes técnicos podem ser enviados ao console somente em ambiente de
//   desenvolvimento com debug habilitado;
// - a interface recebe apenas mensagens previamente definidas como seguras.
//
// Evolução futura:
// - substituir mensagens dispersas por códigos/contexts normalizados;
// - integrar observabilidade externa pelo GlobalErrorHandlerService;
// - padronizar notificações de ação, loading e retry sem revelar internals.
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { environment } from 'src/environments/environment';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

@Injectable({
  providedIn: 'root',
})
export class ErrorNotificationService {
   private readonly snackBar = inject(MatSnackBar);
  private readonly defaultDuration = 5000;
  private readonly recentMessages = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor() {}

  /**
   * Exibe confirmação de operação concluída.
   */
  showSuccess(message: string, duration: number = 3000): void {
    this.openUniqueMessage(
      this.normalizeUserMessage(message, 'Ação concluída com sucesso.'),
      'success-snackbar',
      duration
    );
  }

  /**
   * Exibe falha em linguagem segura para o usuário.
   *
   * `details` é mantido para compatibilidade com os chamadores atuais, mas
   * nunca é exposto na interface. Isso evita revelar mensagens internas do
   * Firebase, rotas, regras, identificadores financeiros ou stack traces.
   */
  showError(
    message: string,
    details?: string,
    duration: number = this.defaultDuration
  ): void {
    this.logTechnicalDetailsForDeveloper(details);

    this.openUniqueMessage(
      this.normalizeUserMessage(
        message,
        'Não foi possível concluir a ação. Tente novamente.'
      ),
      'error-snackbar',
      duration
    );
  }

  /**
   * Exibe informação operacional não crítica.
   */
  showInfo(message: string, duration: number = 4000): void {
    this.openUniqueMessage(
      this.normalizeUserMessage(message, 'Informação indisponível.'),
      'info-snackbar',
      duration
    );
  }

  /**
   * Exibe alerta que exige atenção, mas não representa falha fatal.
   */
  showWarning(
    message: string,
    duration: number = this.defaultDuration
  ): void {
    this.openUniqueMessage(
      this.normalizeUserMessage(message, 'Verifique os dados informados.'),
      'warning-snackbar',
      duration
    );
  }

  /**
   * Exibe uma informação persistente, fechada manualmente pelo usuário.
   *
   * Útil para estados que exigem decisão, como indisponibilidade prolongada
   * ou orientação de segurança.
   */
  showPersistent(message: string): void {
    this.openUniqueMessage(
      this.normalizeUserMessage(message, 'Atenção necessária.'),
      'persistent-snackbar',
      undefined
    );
  }

  /**
   * Exibe erro genérico sem detalhes técnicos.
   */
  showGenericError(): void {
    this.showError(
      'Ocorreu um erro inesperado. Por favor, tente novamente mais tarde.'
    );
  }

  /**
   * Fecha a notificação atual e libera novamente as mensagens deduplicadas.
   */
  clearError(): void {
    this.snackBar.dismiss();

    for (const timeoutId of this.recentMessages.values()) {
      clearTimeout(timeoutId);
    }

    this.recentMessages.clear();
  }

  /**
   * Entrada genérica preservada para consumidores atuais.
   */
  showNotification(
    type: NotificationType,
    message: string,
    duration?: number
  ): void {
    switch (type) {
      case 'success':
        this.showSuccess(message, duration);
        return;

      case 'error':
        this.showError(message, undefined, duration);
        return;

      case 'info':
        this.showInfo(message, duration);
        return;

      case 'warning':
        this.showWarning(message, duration);
        return;
    }
  }

  /**
   * Exibe uma mensagem apenas se ela não tiver sido apresentada recentemente.
   *
   * A deduplicação é feita pelo texto seguro final. Assim, dois erros
   * técnicos diferentes que gerem a mesma mensagem amigável não inundam a UI.
   */
  private openUniqueMessage(
    message: string,
    panelClass: string,
    duration: number | undefined
  ): void {
    if (!this.reserveMessage(message)) {
      return;
    }

    this.snackBar.open(message, 'Fechar', {
      duration,
      panelClass: [panelClass],
    });
  }

  /**
   * Reserva temporariamente uma mensagem para impedir repetições rápidas.
   */
  private reserveMessage(message: string): boolean {
    if (this.recentMessages.has(message)) {
      return false;
    }

    const timeoutId = setTimeout(() => {
      this.recentMessages.delete(message);
    }, this.defaultDuration);

    this.recentMessages.set(message, timeoutId);

    return true;
  }

  /**
   * Impede que objetos, erros ou valores inesperados sejam renderizados como
   * mensagem na interface.
   */
  private normalizeUserMessage(
    message: unknown,
    fallback: string
  ): string {
    if (typeof message !== 'string') {
      return fallback;
    }

    const normalized = message.trim();

    return normalized || fallback;
  }

  /**
   * Mantém capacidade de diagnóstico apenas para desenvolvimento controlado.
   *
   * Nenhum detalhe técnico é apresentado ao usuário. Em produção, nem mesmo o
   * console recebe esse conteúdo por este serviço.
   */
  private logTechnicalDetailsForDeveloper(details?: string): void {
    if (
      environment.production ||
      !environment.enableDebugTools ||
      !details?.trim()
    ) {
      return;
    }

    console.debug(
      '[ErrorNotificationService][debug] Detalhe técnico ocultado da interface:',
      details
    );
  }
}