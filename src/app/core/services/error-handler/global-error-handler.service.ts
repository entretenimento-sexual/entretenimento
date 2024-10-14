//src\app\core\services\error-handler\global-error-handler.service.ts
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
    const errorMessage = this.formatErrorMessage(error);
    notifier.showError(errorMessage);
    this.logError(error);
  }

  private formatErrorMessage(error: Error | HttpErrorResponse): string {
    if (error instanceof HttpErrorResponse) {
      return `Erro de rede: ${error.message}`;
    } else {
      return `Erro inesperado: ${error.message}`;
    }
  }

  private logError(error: Error | HttpErrorResponse): void {
    console.error('Erro:', error);
    // Aqui você pode integrar com um serviço de logging, como Sentry ou LogRocket
  }
}
