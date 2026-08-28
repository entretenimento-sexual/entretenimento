// src/app/core/utils/firebase-error-utils.ts
// -----------------------------------------------------------------------------
// Utilitários pequenos e puros para classificar erros do Firebase/Firestore.
// Mantém os services de domínio mais enxutos e evita duplicação de heurística.
// -----------------------------------------------------------------------------

export interface IFirebaseLikeError {
  code?: unknown;
  message?: unknown;
  name?: unknown;
}

export function isFirebasePermissionDeniedError(error: unknown): boolean {
  const source = error as IFirebaseLikeError | null | undefined;
  const code = String(source?.code ?? '').toLowerCase();
  const message = String(source?.message ?? '').toLowerCase();
  const name = String(source?.name ?? '').toLowerCase();

  return code.includes('permission-denied')
    || code.includes('permission_denied')
    || message.includes('permission')
    || message.includes('no matching allow statements')
    || name.includes('permission');
}

export function toErrorInstance(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}
