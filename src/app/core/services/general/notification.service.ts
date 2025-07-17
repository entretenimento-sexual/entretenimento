//src\app\core\services\general\notification.service.ts
import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly defaultDuration = 5000; // 5 segundos por padrão
  private recentMessages = new Set<string>(); // Previne mensagens repetidas

  constructor(private snackBar: MatSnackBar,
              private dialog: MatDialog) { }

  /**
   * Exibe uma notificação de sucesso.
   * @param message Mensagem a ser exibida.
   * @param duration Duração da exibição (opcional).
   */
  showSuccess(message: string, duration: number = 3000): void {
    this.showUniqueMessage(message, 'success-snackbar', duration);
  }

  /**
   * Exibe uma notificação de erro com detalhes opcionais.
   * @param message Mensagem principal.
   * @param details Detalhes adicionais do erro (opcional).
   * @param duration Duração da exibição.
   */
  showError(message: string, details?: string, duration: number = this.defaultDuration): void {
    if (this.addMessageToRecent(message)) {
      this.snackBar.open(message, 'Ver Detalhes', {
        duration,
        panelClass: ['error-snackbar']
      }).onAction().subscribe(() => {
        if (details) {
          console.log('Detalhes do erro:', details);
          alert(details); // 🔥 Substituível por um modal de erro mais elegante no futuro
        }
      });
    }
  }

  /**
   * Exibe uma notificação de informação.
   * @param message Mensagem informativa.
   * @param duration Duração da exibição (opcional).
   */
  showInfo(message: string, duration: number = 4000): void {
    this.showUniqueMessage(message, 'info-snackbar', duration);
  }

  /**
   * Exibe uma notificação de aviso.
   * @param message Mensagem de aviso.
   * @param duration Duração da exibição (opcional).
   */
  showWarning(message: string, duration: number = this.defaultDuration): void {
    this.showUniqueMessage(message, 'warning-snackbar', duration);
  }

  /**
   * Exibe uma notificação persistente (que só fecha manualmente).
   * @param message Mensagem a ser exibida.
   */
  showPersistent(message: string): void {
    this.snackBar.open(message, 'Fechar', {
      panelClass: ['persistent-snackbar'],
      duration: undefined // 🔥 Sem tempo limite
    });
  }

  /**
   * Método genérico para exibir mensagens únicas.
   * @param message Texto da notificação.
   * @param panelClass Classe CSS para personalização do estilo.
   * @param duration Tempo de exibição.
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
   * Previne notificações duplicadas em curto intervalo de tempo.
   * @param message Texto da notificação.
   * @returns `true` se a mensagem for nova, `false` se já foi exibida recentemente.
   */
  private addMessageToRecent(message: string): boolean {
    if (this.recentMessages.has(message)) {
      return false; // Impede duplicação
    }
    this.recentMessages.add(message);
    setTimeout(() => this.recentMessages.delete(message), this.defaultDuration);
    return true;
  }

  /**
   * Método genérico para exibir notificações por tipo.
   * @param type Tipo da notificação ('success', 'error', 'info', 'warning').
   * @param message Mensagem da notificação.
   * @param duration Duração opcional da notificação.
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
}
