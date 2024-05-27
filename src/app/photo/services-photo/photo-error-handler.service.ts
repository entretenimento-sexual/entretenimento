// src\app\photo\services-photo\photo-error-handler.service.ts
import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';


@Injectable({
  providedIn: 'root'
})
export class PhotoErrorHandlerService {
  constructor(private notifier: ErrorNotificationService) { }

  handleError(error: Error | HttpErrorResponse): void {
    const errorMessage = this.formatErrorMessage(error);
    this.notifier.showError(errorMessage);
    this.logError(error);
    this.sendErrorToSentry(error);
  }

  private formatErrorMessage(error: Error | HttpErrorResponse): string {
    if (error instanceof HttpErrorResponse) {
      return `Erro de rede no módulo Photo: ${error.message}`;
    } else {
      return `Erro inesperado no módulo Photo: ${error.message}`;
    }
  }

  private logError(error: Error | HttpErrorResponse): void {
    console.error('Erro no módulo Photo:', error);
  }

  private sendErrorToSentry(error: Error | HttpErrorResponse): void {
    Sentry.captureException(error);
  }
}
