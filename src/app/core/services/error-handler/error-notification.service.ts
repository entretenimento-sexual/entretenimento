// src\app\core\services\error-handler\error-notification.service.ts
import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class ErrorNotificationService {
  private readonly defaultDuration = 5000; // Duração padrão para notificações

  constructor(private snackBar: MatSnackBar) { }

  /**
   * Exibe uma mensagem de sucesso.
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showSuccess(message: string, duration: number = 3000): void {
    this.snackBar.open(message, 'Fechar', {
      duration,
      panelClass: ['success-snackbar']
    });
  }

  /**
   * Exibe uma mensagem de erro.
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showError(message: string, duration: number = this.defaultDuration): void {
    this.snackBar.open(message, 'Fechar', {
      duration,
      panelClass: ['error-snackbar']
    });
  }

  /**
   * Exibe uma mensagem de informação.
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showInfo(message: string, duration: number = 4000): void {
    this.snackBar.open(message, 'Fechar', {
      duration,
      panelClass: ['info-snackbar']
    });
  }

  /**
   * Exibe uma mensagem de aviso.
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showWarning(message: string, duration: number = this.defaultDuration): void {
    this.snackBar.open(message, 'Fechar', {
      duration,
      panelClass: ['warning-snackbar']
    });
  }

  /**
   * Exibe uma mensagem de erro genérica.
   * Útil para cenários onde a mensagem de erro não está disponível.
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
   * Método genérico para exibir mensagens de acordo com o tipo.
   * @param type Tipo de mensagem ('success', 'error', 'info', 'warning')
   * @param message Mensagem a ser exibida
   * @param duration (opcional) Duração em milissegundos
   */
  showNotification(type: 'success' | 'error' | 'info' | 'warning', message: string, duration?: number): void {
    const types = {
      success: () => this.showSuccess(message, duration),
      error: () => this.showError(message, duration),
      info: () => this.showInfo(message, duration),
      warning: () => this.showWarning(message, duration)
    };
    types[type]?.();
  }
}
