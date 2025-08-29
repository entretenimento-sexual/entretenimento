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
   * Lida com erros específicos do Firestore, exibindo mensagens personalizadas para o usuário
   * e logando detalhes completos para o desenvolvedor.
   * @param error Erro retornado pela operação no Firestore.
   * @returns Um Observable que lança o erro original.
   */
  handleFirestoreError(error: any): Observable<never> {
    let userFriendlyMessage: string; // Mensagem formatada para o usuário
    let consoleLogMessage: string;   // Mensagem detalhada para o console

    if (error instanceof FirebaseError) {
      // Mapeia códigos de erro do Firebase para mensagens amigáveis.
      userFriendlyMessage = this.getErrorMessage(error.code);
      consoleLogMessage = `[FirestoreErrorHandler] Erro Firebase (${error.code}): ${userFriendlyMessage}`;
    } else {
      // Lida com erros que não são instâncias de FirebaseError (erros inesperados).
      userFriendlyMessage = 'Ocorreu um erro inesperado no Firestore.';
      consoleLogMessage = '[FirestoreErrorHandler] Erro inesperado:';
      this.notifier.showGenericError(); // Exibe uma notificação genérica para erros não mapeados.
    }

    // Exibe a mensagem amigável para o usuário através do serviço de notificação.
    // O 'error.message' original é passado como um detalhe opcional, que pode ser exibido
    // se o ErrorNotificationService tiver essa funcionalidade (ex: botão "Detalhes").
    this.notifier.showError(userFriendlyMessage, error.message);

    // Loga o erro completo no console para o desenvolvedor.
    console.log(consoleLogMessage, error);

    // Re-lança o erro original para que a cadeia de Observables possa continuar
    // tratando ou propagando o erro.
    return throwError(() => error);
  }

  /**
   * Mapeia códigos de erro do Firestore para mensagens mais amigáveis e compreensíveis pelo usuário.
   * @param code Código de erro do Firestore (ex: 'permission-denied', 'unavailable').
   * @returns Uma string com a mensagem amigável correspondente ao código de erro.
   */
  private getErrorMessage(code: string): string {
    switch (code) {
      case 'permission-denied':
        return 'Você não tem permissão para realizar esta ação. Verifique suas credenciais.';
      case 'unavailable':
        return 'O serviço do Firestore está temporariamente indisponível. Por favor, tente novamente mais tarde.';
      case 'not-found':
        return 'O documento solicitado não foi encontrado. Pode ter sido removido ou o ID está incorreto.';
      case 'already-exists':
        return 'O documento que você está tentando criar já existe. Por favor, use um nome diferente.';
      case 'resource-exhausted':
        return 'Limite de requisições ao Firestore excedido. Por favor, tente novamente mais tarde ou contate o suporte.';
      case 'deadline-exceeded':
        return 'A operação demorou muito para ser concluída. Verifique sua conexão com a internet e tente novamente.';
      case 'aborted':
        return 'A operação foi abortada. Isso pode ocorrer devido a conflitos de transação. Tente novamente.';
      case 'cancelled':
        return 'A operação foi cancelada. Isso pode acontecer se a requisição foi interrompida.';
      case 'data-loss':
        return 'Houve um problema de integridade de dados. Por favor, contate o suporte.';
      case 'internal':
        return 'Ocorreu um erro interno no servidor do Firestore. Por favor, tente novamente mais tarde.';
      case 'invalid-argument':
        return 'Um argumento inválido foi fornecido para a operação. Verifique os dados e tente novamente.';
      case 'out-of-range':
        return 'Um valor fornecido está fora do intervalo permitido.';
      case 'unauthenticated':
        return 'Você precisa estar autenticado para realizar esta ação.';
      case 'unimplemented':
        return 'Esta funcionalidade ainda não foi implementada.';
      case 'unknown':
        return 'Ocorreu um erro desconhecido no Firestore.';
      default:
        // Mensagem padrão para códigos de erro não explicitamente mapeados.
        return 'Ocorreu um erro inesperado no Firestore. Por favor, tente novamente.';
    }
  }
}
