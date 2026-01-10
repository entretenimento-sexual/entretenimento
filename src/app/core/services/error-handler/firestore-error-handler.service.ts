// src/app/core/services/error-handler/firestore-error-handler.service.ts
import { Injectable } from '@angular/core';
import { FirebaseError } from 'firebase/app';
import { Observable, EMPTY, of, throwError } from 'rxjs';
import { ErrorNotificationService } from './error-notification.service';

export type FirestoreErrorHandlerOptions = {
  /** Quando true, não exibe toast/snackbar — mas mantém log para dev */
  silent?: boolean;

  /** Contexto para facilitar debug (ex: nickname-soft, register-submit etc) */
  context?: string;
};

type NormalizedError = {
  userMessage: string;
  details?: string;
  code?: string;
  consolePrefix: string;
};

@Injectable({ providedIn: 'root' })
export class FirestoreErrorHandlerService {
  constructor(private notifier: ErrorNotificationService) { }

  // ============================================================================
  // 1) MODO “FALHA” (mantém seu comportamento atual)
  // - Use quando você QUER que o fluxo quebre (ex.: submit/commit crítico)
  // ============================================================================
  handleFirestoreError(error: any, opts?: FirestoreErrorHandlerOptions): Observable<never> {
    const n = this.normalize(error, opts);

    this.notifyIfNeeded(n, opts);
    this.logError(n, error);

    return throwError(() => error);
  }

  // ============================================================================
  // 2) MODO “FALLBACK” (mais genérico)
  // - Use quando você NÃO quer derrubar o stream
  // - Ideal pra realtime/presença/listagens/VM selectors via effects
  // ============================================================================
  handleFirestoreErrorAndReturn<T>(
    error: any,
    fallback: T,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<T> {
    const n = this.normalize(error, opts);

    this.notifyIfNeeded(n, opts);
    this.logError(n, error);

    return of(fallback);
  }

  /** Atalho: retorna [] (muito comum em queries/listas) */
  handleFirestoreErrorAndReturnEmptyArray<T>(
    error: any,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<T[]> {
    return this.handleFirestoreErrorAndReturn<T[]>(error, [], opts);
  }

  /** Atalho: retorna null (muito comum em docById) */
  handleFirestoreErrorAndReturnNull<T>(
    error: any,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<T | null> {
    return this.handleFirestoreErrorAndReturn<T | null>(error, null, opts);
  }

  /** Atalho: completa sem emitir (quando UI não precisa nem de fallback) */
  handleFirestoreErrorAndComplete<T>(
    error: any,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<T> {
    const n = this.normalize(error, opts);

    this.notifyIfNeeded(n, opts);
    this.logError(n, error);

    return EMPTY;
  }

  // ============================================================================
  // 3) MODO “SIDE-EFFECT ONLY” (mais genérico ainda)
  // - Só notifica/loga, sem mexer no controle do fluxo
  // - Útil quando você quer tratar fora do catchError
  // ============================================================================
  report(error: any, opts?: FirestoreErrorHandlerOptions): void {
    const n = this.normalize(error, opts);
    this.notifyIfNeeded(n, opts);
    this.logError(n, error);
  }

  // ============================================================================
  // Internals (genéricos)
  // ============================================================================

  private normalize(error: any, opts?: FirestoreErrorHandlerOptions): NormalizedError {
    const silent = opts?.silent === true;
    const context = opts?.context ? ` | ctx=${opts.context}` : '';

    const details = typeof error?.message === 'string' ? error.message : undefined;

    if (error instanceof FirebaseError) {
      const userMessage = this.getErrorMessage(error.code);
      return {
        userMessage,
        details,
        code: error.code,
        consolePrefix: `[FirestoreErrorHandler] FirebaseError (${error.code})${context}${silent ? ' [silent]' : ''}`,
      };
    }

    return {
      userMessage: 'Ocorreu um erro inesperado no Firestore.',
      details,
      consolePrefix: `[FirestoreErrorHandler] Erro inesperado${context}${silent ? ' [silent]' : ''}`,
    };
  }

  private notifyIfNeeded(n: NormalizedError, opts?: FirestoreErrorHandlerOptions): void {
    if (opts?.silent === true) return;
    // Mantém seu padrão showError(msg, details)
    this.notifier.showError(n.userMessage, n.details);
  }

  private logError(n: NormalizedError, raw: any): void {
    // Se quiser deixar ainda mais “plataforma grande”:
    // - em prod: console.warn/console.error pode ser reduzido
    // - e mandar pra telemetry (Sentry etc) no GlobalErrorHandler
    console.error(n.consolePrefix, raw);
  }

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
        return 'Ocorreu um erro inesperado no Firestore. Por favor, tente novamente.';
    }
  }
}// Linha 94 - Há métodos aqui no FirestoreErrorHandlerService que não sejam tão específicos?
