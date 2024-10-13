//src\app\core\services\error-handler\error-notification.service.ts
import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class ErrorNotificationService {
  constructor(private snackBar: MatSnackBar) { }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Fechar', { duration: 3000, panelClass: ['success-snackbar'] });
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Fechar', { duration: 5000, panelClass: ['error-snackbar'] });
  }

  showInfo(message: string): void {
    this.snackBar.open(message, 'Fechar', { duration: 4000, panelClass: ['info-snackbar'] });
  }

  showWarning(message: string): void {
    this.snackBar.open(message, 'Fechar', { duration: 5000, panelClass: ['warning-snackbar'] });
  }

  // Novo método para limpar erros sem exibir snackbar
  clearError(): void {
    this.snackBar.dismiss(); // Simplesmente fecha qualquer snackbar que esteja aberto
  }
}

