// src/app/core/services/general/notification.service.ts
// -----------------------------------------------------------------------------
// NOTIFICATION SERVICE
// -----------------------------------------------------------------------------
//
// Fachada retrocompatível para consumidores antigos da aplicação.
//
// Direção arquitetural:
// - ErrorNotificationService é o ponto central de feedback visual;
// - este serviço permanece apenas para preservar imports e nomenclaturas
//   eventualmente existentes em fluxos legados;
// - não mantém estado próprio;
// - não acessa MatSnackBar diretamente;
// - não utiliza MatDialog;
// - não exibe detalhes técnicos.
//
// Segurança:
// - `details` continua aceito por compatibilidade;
// - a decisão de ocultar detalhes técnicos está centralizada em
//   ErrorNotificationService;
// - mensagens internas de Firebase, Functions, Storage, billing ou moderação
//   não são abertas em alertas ou modais pelo navegador.
//
// Evolução futura:
// - após migração total dos consumidores para ErrorNotificationService,
//   esta fachada poderá ser removida.

import { Injectable, inject } from '@angular/core';

import {
  ErrorNotificationService,
  type NotificationType,
} from '../error-handler/error-notification.service';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly notifier = inject(ErrorNotificationService);

  /**
   * Exibe feedback visual positivo.
   */
  showSuccess(
    message: string,
    duration: number = 3000
  ): void {
    this.notifier.showSuccess(message, duration);
  }

  /**
   * Exibe feedback visual de erro.
   *
   * `details` é preservado somente para compatibilidade com consumidores
   * antigos. O serviço central garante que esse conteúdo não seja mostrado
   * diretamente ao usuário.
   */
  showError(
    message: string,
    details?: string,
    duration: number = 5000
  ): void {
    this.notifier.showError(message, details, duration);
  }

  /**
   * Exibe mensagem informativa.
   */
  showInfo(
    message: string,
    duration: number = 4000
  ): void {
    this.notifier.showInfo(message, duration);
  }

  /**
   * Exibe aviso não bloqueante.
   */
  showWarning(
    message: string,
    duration: number = 5000
  ): void {
    this.notifier.showWarning(message, duration);
  }

  /**
   * Exibe mensagem persistente até fechamento manual.
   */
  showPersistent(message: string): void {
    this.notifier.showPersistent(message);
  }

  /**
   * Mantém a entrada genérica utilizada por consumidores legados.
   */
  showNotification(
    type: NotificationType,
    message: string,
    duration?: number
  ): void {
    this.notifier.showNotification(type, message, duration);
  }
}