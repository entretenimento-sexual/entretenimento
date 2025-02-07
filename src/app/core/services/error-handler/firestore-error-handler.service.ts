// src/app/core/services/error-handler/firestore-error-handler.service.ts
import { Injectable } from '@angular/core';
import { ErrorNotificationService } from './error-notification.service';
import { FirebaseError } from 'firebase/app';
import { throwError, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FirestoreErrorHandlerService {

  constructor(private notifier: ErrorNotificationService) { }

  /**
   * Lida com erros específicos do Firestore, exibindo mensagens personalizadas.
   * @param error Erro retornado pela operação no Firestore
   */
  handleFirestoreError(error: any): Observable<never> {
    if (error instanceof FirebaseError) {
      // Mapeia códigos de erro para mensagens amigáveis
      const message = this.getErrorMessage(error.code);
      this.notifier.showError(message, error.message); // Exibe a mensagem no UI
      console.error(`[FirestoreErrorHandler] ${message}`, error); // Log no console
    } else {
      // Erros não relacionados ao Firebase
      this.notifier.showGenericError();
      console.error('[FirestoreErrorHandler] Erro inesperado:', error);
    }

    return throwError(() => error);
  }

  /**
   * Mapeia códigos de erro do Firestore para mensagens mais amigáveis.
   * @param code Código de erro do Firestore
   * @returns Mensagem amigável para o usuário
   */
  private getErrorMessage(code: string): string {
    switch (code) {
      case 'permission-denied':
        return 'Você não tem permissão para realizar esta ação.';
      case 'unavailable':
        return 'O serviço do Firestore está temporariamente indisponível. Tente novamente mais tarde.';
      case 'not-found':
        return 'O documento solicitado não foi encontrado.';
      case 'already-exists':
        return 'O documento que você está tentando criar já existe.';
      case 'resource-exhausted':
        return 'Limite de requisições ao Firestore excedido. Tente novamente mais tarde.';
      case 'deadline-exceeded':
        return 'A operação demorou muito para ser concluída. Verifique sua conexão e tente novamente.';
      default:
        return 'Ocorreu um erro inesperado no Firestore.';
    }
  }
}
