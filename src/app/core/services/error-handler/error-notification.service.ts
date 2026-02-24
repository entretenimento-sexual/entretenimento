// src\app\core\services\error-handler\error-notification.service.ts
// Não esquecer comentários explicativos e ferramentas de debug
import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class ErrorNotificationService {
  private readonly defaultDuration = 5000; // Duração padrão para notificações
  private recentMessages = new Set<string>(); // Armazena mensagens recentes para evitar duplicações

  constructor(private snackBar: MatSnackBar) { }

  /**
   * Exibe uma mensagem de sucesso.
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showSuccess(message: string, duration: number = 3000): void {
    this.showUniqueMessage(message, 'success-snackbar', duration);
  }

  /**
   * Exibe uma mensagem de erro.
   * @param message Mensagem a ser exibida
   * @param details (opcional) Detalhes do erro
   * @param duration (opcional) Duração em milissegundos
   */
  showError(message: string, details?: string, duration: number = this.defaultDuration): void {
    if (this.addMessageToRecent(message)) {
      this.snackBar.open(message, 'Detalhes', {
        duration,
        panelClass: ['error-snackbar']
      }).onAction().subscribe(() => {
        if (details) {
          console.log('Detalhes do erro:', details);
          alert(details); // Exibe detalhes em um modal ou alerta
        }
      });
    }
  }

  /**
   * Exibe uma mensagem de informação.
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showInfo(message: string, duration: number = 4000): void {
    this.showUniqueMessage(message, 'info-snackbar', duration);
  }

  /**
   * Exibe uma mensagem de aviso.
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showWarning(message: string, duration: number = this.defaultDuration): void {
    this.showUniqueMessage(message, 'warning-snackbar', duration);
  }

  /**
   * Exibe uma mensagem genérica de erro.
   */
  showGenericError(): void {
    this.showError('Ocorreu um erro inesperado. Por favor, tente novamente mais tarde.');
  }

  /**
   * Fecha qualquer snackbar que esteja aberto.
   */
  clearError(): void {
    this.snackBar.dismiss();
  }

  /**
   * Método genérico para exibir mensagens únicas de acordo com o tipo.
   * @param message Mensagem a ser exibida
   * @param panelClass Classe CSS para estilização
   * @param duration Duração da mensagem em milissegundos
   */
  private showUniqueMessage(message: string, panelClass: string, duration: number): void {
    if (this.addMessageToRecent(message)) {
      this.snackBar.open(message, 'Fechar', {
        duration,
        panelClass: [panelClass]
      });
    }
  }

  /**
   * Previne a exibição de mensagens repetidas em um curto intervalo de tempo.
   * @param message Mensagem a ser exibida
   * @returns Retorna `true` se a mensagem for adicionada; `false` se já existir recentemente.
   */
  private addMessageToRecent(message: string): boolean {
    if (this.recentMessages.has(message)) {
      return false; // Impede mensagens duplicadas
    }
    this.recentMessages.add(message);
    setTimeout(() => this.recentMessages.delete(message), this.defaultDuration); // Remove após o tempo padrão
    return true;
  }

  /**
   * Método genérico para exibir mensagens de acordo com o tipo.
   * @param type Tipo de mensagem ('success', 'error', 'info', 'warning')
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showNotification(type: 'success' | 'error' | 'info' | 'warning', message: string, duration?: number): void {
    const types = {
      success: () => this.showSuccess(message, duration),
      error: () => this.showError(message, undefined, duration),
      info: () => this.showInfo(message, duration),
      warning: () => this.showWarning(message, duration)
    };
    types[type]?.();
  }
} // Linha 120 - Fim do ErrorNotificationService
/*
src/app/core/services/error-handler/global-error-handler.service.ts
→ fallback “última linha” (erros não tratados)

src/app/core/services/error-handler/error-notification.service.ts
→ único ponto para notificar usuário (toast/snackbar/modal)

src/app/core/services/error-handler/firestore-error-handler.service.ts
→ padronizar erro do Firebase/Firestore (mapear codes, contextos)

Regra prática: em qualquer service com Observable, faça catchError(err => this.firestoreErrorHandler.handle$(...) ) e deixe o notifier centralizar UX.
*/
