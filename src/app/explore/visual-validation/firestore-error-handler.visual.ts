import { Injectable } from '@angular/core';
import { EMPTY, Observable, of, throwError } from 'rxjs';

export type FirestoreErrorHandlerOptions = {
  silent?: boolean;
  context?: string;
};

/**
 * Replacement exclusivo do harness visual de `/descobrir`.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - não mostra snackbar/toast para erros de Firestore;
 * - não encaminha os erros esperados do usuário fictício ao logger global.
 *
 * Motivo:
 * o shell real ainda contém widgets auxiliares que podem tentar leituras reais.
 * O usuário determinístico do harness não existe no backend, portanto essas
 * leituras podem receber `permission-denied` sem relação com a página auditada.
 *
 * A semântica de controle de fluxo é preservada:
 * - falha crítica continua emitindo erro;
 * - fallback continua retornando o valor solicitado;
 * - complete continua completando sem emissão.
 *
 * O serviço real permanece intacto e é exercitado pelos builds/testes normais
 * executados antes de qualquer replacement visual.
 */
@Injectable({ providedIn: 'root' })
export class FirestoreErrorHandlerService {
  handleFirestoreError(
    error: unknown,
    _options?: FirestoreErrorHandlerOptions
  ): Observable<never> {
    return throwError(() => error);
  }

  handleFirestoreErrorAndReturn<T>(
    _error: unknown,
    fallback: T,
    _options?: FirestoreErrorHandlerOptions
  ): Observable<T> {
    return of(fallback);
  }

  handleFirestoreErrorAndReturnEmptyArray<T>(
    _error: unknown,
    _options?: FirestoreErrorHandlerOptions
  ): Observable<T[]> {
    return of([]);
  }

  handleFirestoreErrorAndReturnNull<T>(
    _error: unknown,
    _options?: FirestoreErrorHandlerOptions
  ): Observable<T | null> {
    return of(null);
  }

  handleFirestoreErrorAndComplete<T>(
    _error: unknown,
    _options?: FirestoreErrorHandlerOptions
  ): Observable<T> {
    return EMPTY;
  }

  report(
    _error: unknown,
    _options?: FirestoreErrorHandlerOptions
  ): void {}
}
