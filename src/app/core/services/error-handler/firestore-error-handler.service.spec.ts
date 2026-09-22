// src/app/core/services/error-handler/firestore-error-handler.service.spec.ts
import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from './application-error.service';
import { FirestoreErrorHandlerService } from './firestore-error-handler.service';

describe('FirestoreErrorHandlerService', () => {
  const applicationError = {
    report: vi.fn(),
  };

  let service: FirestoreErrorHandlerService;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new FirestoreErrorHandlerService(
      applicationError as unknown as ApplicationErrorService
    );
  });

  it('delega FirebaseError ao pipeline canônico e relança o mesmo erro', () => {
    const error = new FirebaseError(
      'permission-denied',
      'firestore internal detail'
    );
    let received: unknown;

    service.handleFirestoreError(error, {
      context: 'save-profile',
    }).subscribe({
      error: (caught) => {
        received = caught;
      },
    });

    expect(received).toBe(error);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        feature: 'firestore',
        operation: 'handleFirestoreError',
        fallbackMessage:
          'Você não tem permissão para realizar esta ação. Verifique suas credenciais.',
        presentation: {
          surface: 'snackbar',
          severity: 'error',
        },
        metadata: {
          scope: 'FirestoreErrorHandlerService',
          firestoreContext: 'save-profile',
          silent: false,
        },
      })
    );

    const tagged = error as FirebaseError & {
      skipUserNotification?: boolean;
      feature?: string;
      context?: string;
    };

    expect(tagged.skipUserNotification).toBe(true);
    expect(tagged.feature).toBe('firestore');
    expect(tagged.context).toBe('save-profile');
  });

  it('preserva fallback e torna apresentação global silenciosa quando solicitado', () => {
    const error = new FirebaseError('unavailable', 'offline');
    const values: string[] = [];

    service.handleFirestoreErrorAndReturn(
      error,
      'fallback',
      {
        silent: true,
        context: 'watch-feed',
      }
    ).subscribe((value) => values.push(value));

    expect(values).toEqual(['fallback']);
    expect(applicationError.report).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        feature: 'firestore',
        operation: 'handleFirestoreErrorAndReturn',
        fallbackMessage:
          'O serviço do Firestore está temporariamente indisponível. Por favor, tente novamente mais tarde.',
        presentation: {
          surface: 'none',
          severity: 'error',
        },
        metadata: {
          scope: 'FirestoreErrorHandlerService',
          firestoreContext: 'watch-feed',
          silent: true,
        },
      })
    );
  });

  it('mantém erro não Firebase com mensagem pública genérica e sem expor detalhe técnico', () => {
    const error = new Error('sensitive backend detail');

    service.report(error);

    expect(applicationError.report).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        feature: 'firestore',
        operation: 'report',
        fallbackMessage:
          'Ocorreu um erro inesperado no Firestore. Por favor, tente novamente.',
      })
    );

    const options = applicationError.report.mock.calls[0]?.[1] as {
      fallbackMessage?: string;
    };

    expect(options.fallbackMessage).not.toContain('sensitive backend detail');
  });

  it('não rediagnostica a mesma instância em camadas Firestore aninhadas', () => {
    const error = new FirebaseError('unavailable', 'offline');

    service.report(error, { silent: true, context: 'lower-layer' });
    service.handleFirestoreErrorAndReturn(error, [], {
      silent: true,
      context: 'upper-layer',
    }).subscribe();

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(service.hasDiagnosticOwnership(error)).toBe(true);
  });

  it('não assume ownership quando o pipeline canônico falha', () => {
    const error = new FirebaseError('unavailable', 'offline');
    applicationError.report.mockImplementationOnce(() => {
      throw new Error('diagnostic pipeline failed');
    });

    service.report(error, { silent: true });

    expect(service.hasDiagnosticOwnership(error)).toBe(false);

    service.report(error, { silent: true });

    expect(applicationError.report).toHaveBeenCalledTimes(2);
    expect(service.hasDiagnosticOwnership(error)).toBe(true);
  });

  it('mantém modo complete sem emissão e com diagnóstico canônico', () => {
    const error = new FirebaseError('aborted', 'transaction conflict');
    const next = vi.fn();
    const complete = vi.fn();

    service.handleFirestoreErrorAndComplete(error).subscribe({
      next,
      complete,
    });

    expect(next).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: 'handleFirestoreErrorAndComplete',
      })
    );
  });

  it('preserva atalhos de array vazio e null sem criar ownership paralelo', () => {
    const error = new FirebaseError('not-found', 'missing');
    const arrays: unknown[][] = [];
    const nulls: Array<unknown | null> = [];

    service.handleFirestoreErrorAndReturnEmptyArray(error, {
      silent: true,
    }).subscribe((value) => arrays.push(value));

    service.handleFirestoreErrorAndReturnNull(error, {
      silent: true,
    }).subscribe((value) => nulls.push(value));

    expect(arrays).toEqual([[]]);
    expect(nulls).toEqual([null]);
    // A mesma instância atravessou dois atalhos: diagnóstico técnico é único.
    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report.mock.calls[0]?.[1]?.operation)
      .toBe('handleFirestoreErrorAndReturn');
  });
});
