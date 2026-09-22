// src/app/core/services/error-handler/firestore-error-handler.service.ts
// -----------------------------------------------------------------------------
// FIRESTORE ERROR HANDLER SERVICE
// -----------------------------------------------------------------------------
// Adaptador de compatibilidade para fluxos Firestore que ainda dependem das
// APIs handle/return/complete/report deste serviço.
//
// Responsabilidades:
// - preservar a semântica reativa dos consumidores atuais;
// - mapear códigos do Firestore para mensagens públicas específicas;
// - delegar apresentação e diagnóstico ao ApplicationErrorService;
// - impedir nova composição manual ErrorNotificationService + GlobalErrorHandlerService;
// - marcar o erro original para evitar uma segunda notificação caso ele escape
//   até o ErrorHandler global.
//
// Este serviço não possui mais responsabilidade própria de snackbar/log.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { FirebaseError } from 'firebase/app';
import { EMPTY, Observable, of, throwError } from 'rxjs';

import { ApplicationErrorService } from './application-error.service';

export type FirestoreErrorHandlerOptions = {
  /** Quando true, não exibe feedback global, mas mantém diagnóstico técnico. */
  silent?: boolean;

  /** Contexto operacional para facilitar triagem (ex.: register-submit). */
  context?: string;
};

type NormalizedError = {
  userMessage: string;
  details?: string;
  code?: string;
  consolePrefix: string;
};

const FIRESTORE_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  'permission-denied':
    'Você não tem permissão para realizar esta ação. Verifique suas credenciais.',
  unavailable:
    'O serviço do Firestore está temporariamente indisponível. Por favor, tente novamente mais tarde.',
  'not-found':
    'O documento solicitado não foi encontrado. Pode ter sido removido ou o ID está incorreto.',
  'already-exists':
    'O documento que você está tentando criar já existe. Por favor, use um nome diferente.',
  'resource-exhausted':
    'Limite de requisições ao Firestore excedido. Por favor, tente novamente mais tarde ou contate o suporte.',
  'deadline-exceeded':
    'A operação demorou muito para ser concluída. Verifique sua conexão com a internet e tente novamente.',
  aborted:
    'A operação foi abortada. Isso pode ocorrer devido a conflitos de transação. Tente novamente.',
  cancelled:
    'A operação foi cancelada. Isso pode acontecer se a requisição foi interrompida.',
  'data-loss':
    'Houve um problema de integridade de dados. Por favor, contate o suporte.',
  internal:
    'Ocorreu um erro interno no servidor do Firestore. Por favor, tente novamente mais tarde.',
  'invalid-argument':
    'Um argumento inválido foi fornecido para a operação. Verifique os dados e tente novamente.',
  'out-of-range':
    'Um valor fornecido está fora do intervalo permitido.',
  unauthenticated:
    'Você precisa estar autenticado para realizar esta ação.',
  unimplemented:
    'Esta funcionalidade ainda não foi implementada.',
  unknown:
    'Ocorreu um erro desconhecido no Firestore.',
});

const FIRESTORE_FALLBACK_MESSAGE =
  'Ocorreu um erro inesperado no Firestore. Por favor, tente novamente.';

@Injectable({ providedIn: 'root' })
export class FirestoreErrorHandlerService {
  constructor(
    private readonly applicationError: ApplicationErrorService
  ) {}

  // ===========================================================================
  // 1) MODO “FALHA”
  // - preserva o erro original e mantém o stream em falha.
  // ===========================================================================
  handleFirestoreError(
    error: unknown,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<never> {
    const normalized = this.normalize(error, opts);

    this.reportCanonical(
      error,
      normalized,
      opts,
      'handleFirestoreError'
    );
    this.tagRawError(error, normalized, opts);

    return throwError(() => error);
  }

  // ===========================================================================
  // 2) MODO “FALLBACK”
  // - diagnostica a falha e devolve o fallback sem encerrar o stream em erro.
  // ===========================================================================
  handleFirestoreErrorAndReturn<T>(
    error: unknown,
    fallback: T,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<T> {
    const normalized = this.normalize(error, opts);

    this.reportCanonical(
      error,
      normalized,
      opts,
      'handleFirestoreErrorAndReturn'
    );
    this.tagRawError(error, normalized, opts);

    return of(fallback);
  }

  /** Atalho: retorna [] (muito comum em queries/listas). */
  handleFirestoreErrorAndReturnEmptyArray<T>(
    error: unknown,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<T[]> {
    return this.handleFirestoreErrorAndReturn<T[]>(error, [], opts);
  }

  /** Atalho: retorna null (muito comum em docById). */
  handleFirestoreErrorAndReturnNull<T>(
    error: unknown,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<T | null> {
    return this.handleFirestoreErrorAndReturn<T | null>(error, null, opts);
  }

  /** Completa sem emitir quando a UI não precisa de fallback. */
  handleFirestoreErrorAndComplete<T>(
    error: unknown,
    opts?: FirestoreErrorHandlerOptions
  ): Observable<T> {
    const normalized = this.normalize(error, opts);

    this.reportCanonical(
      error,
      normalized,
      opts,
      'handleFirestoreErrorAndComplete'
    );
    this.tagRawError(error, normalized, opts);

    return EMPTY;
  }

  // ===========================================================================
  // 3) MODO “SIDE-EFFECT ONLY”
  // - diagnostica sem alterar o controle do fluxo do chamador.
  // ===========================================================================
  report(error: unknown, opts?: FirestoreErrorHandlerOptions): void {
    const normalized = this.normalize(error, opts);

    this.reportCanonical(error, normalized, opts, 'report');
    this.tagRawError(error, normalized, opts);
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private reportCanonical(
    error: unknown,
    normalized: NormalizedError,
    opts: FirestoreErrorHandlerOptions | undefined,
    operation:
      | 'handleFirestoreError'
      | 'handleFirestoreErrorAndReturn'
      | 'handleFirestoreErrorAndComplete'
      | 'report'
  ): void {
    this.applicationError.report(error, {
      feature: 'firestore',
      operation,
      fallbackMessage: normalized.userMessage,
      codeMessages: FIRESTORE_ERROR_MESSAGES,
      presentation: opts?.silent === true
        ? { surface: 'none', severity: 'error' }
        : { surface: 'snackbar', severity: 'error' },
      metadata: {
        scope: 'FirestoreErrorHandlerService',
        firestoreContext: opts?.context ?? null,
        silent: opts?.silent === true,
      },
    });
  }

  private normalize(
    error: unknown,
    opts?: FirestoreErrorHandlerOptions
  ): NormalizedError {
    const silent = opts?.silent === true;
    const context = opts?.context ? ` | ctx=${opts.context}` : '';
    const details =
      error instanceof Error && typeof error.message === 'string'
        ? error.message
        : undefined;

    if (error instanceof FirebaseError) {
      const code = this.normalizeCode(error.code);
      const userMessage = FIRESTORE_ERROR_MESSAGES[code]
        ?? FIRESTORE_FALLBACK_MESSAGE;

      return {
        userMessage,
        details,
        code,
        consolePrefix:
          `[FirestoreErrorHandler] FirebaseError (${code})${context}`
          + (silent ? ' [silent]' : ''),
      };
    }

    return {
      userMessage: FIRESTORE_FALLBACK_MESSAGE,
      details,
      consolePrefix:
        `[FirestoreErrorHandler] Erro inesperado${context}`
        + (silent ? ' [silent]' : ''),
    };
  }

  private normalizeCode(code: string): string {
    return code.replace(/^firestore\//, '');
  }

  /**
   * Preserva a proteção de compatibilidade quando o mesmo erro relançado chega
   * posteriormente ao ErrorHandler global. A UI já foi resolvida pelo pipeline
   * canônico, portanto uma segunda notificação deve ser bloqueada.
   */
  private tagRawError(
    raw: unknown,
    normalized: NormalizedError,
    opts?: FirestoreErrorHandlerOptions
  ): void {
    if (
      (typeof raw !== 'object' || raw === null)
      && typeof raw !== 'function'
    ) {
      return;
    }

    try {
      const target = raw as Record<string, unknown>;

      target['silent'] = opts?.silent === true;
      target['skipUserNotification'] = true;
      target['context'] = opts?.context;
      target['feature'] = 'firestore';
      target['consolePrefix'] = normalized.consolePrefix;

      if (!target['code'] && normalized.code) {
        target['code'] = normalized.code;
      }
      if (!target['details'] && normalized.details) {
        target['details'] = normalized.details;
      }
    } catch {
      // Erros congelados/imutáveis continuam sendo tratados sem mutação.
    }
  }
}
