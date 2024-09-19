//src\app\core\services\error-handler\error-notification.service.ts
import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class ErrorNotificationService {
  constructor(private snackBar: MatSnackBar) { }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Fechar', { duration: 3000 });
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Fechar', { duration: 5000, panelClass: ['error-snackbar'] });
  }
}

