import type { Auth } from '@angular/fire/auth';
import { signOut } from 'firebase/auth';

import { environment } from '../../../environments/environment';
import { GlobalErrorHandlerService } from '../services/error-handler/global-error-handler.service';
import {
  firebaseDebugLog,
  getFirebaseEmulatorEndpoint,
  resolveFirebaseAuthEmulatorPersistenceMode,
} from './firebase-environment.config';

type AuthWithOptionalStateReady = Auth & {
  authStateReady?: () => Promise<void>;
};

const INVALID_SESSION_ERROR_CODES = new Set([
  'auth/user-not-found',
  'auth/invalid-user-token',
  'auth/user-token-expired',
  'auth/user-disabled',
]);

function extractFirebaseErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return '';
  }

  return String((error as { code?: unknown }).code ?? '');
}

function normalizeInitializerError(error: unknown): Error {
  if (error instanceof Error) return error;

  return new Error(
    typeof error === 'string'
      ? error
      : 'Falha desconhecida ao restaurar a sessão do Firebase Auth.'
  );
}

export function authRestoreInitializer(
  auth: Auth,
  globalErrorHandler: GlobalErrorHandlerService
): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      await ((auth as AuthWithOptionalStateReady).authStateReady?.() ??
        Promise.resolve());

      const authEmulatorEndpoint = getFirebaseEmulatorEndpoint('auth');
      const usingAuthEmulator = authEmulatorEndpoint !== null;
      const persistenceMode = usingAuthEmulator
        ? resolveFirebaseAuthEmulatorPersistenceMode()
        : 'cloud';

      firebaseDebugLog('[AUTH][INIT] authStateReady()', {
        env: environment.env,
        usingAuthEmulator,
        persistenceMode,
        currentUserUid: auth.currentUser?.uid ?? null,
      });

      if (!usingAuthEmulator) return;

      const currentUser = auth.currentUser;

      if (persistenceMode === 'memory' && currentUser) {
        firebaseDebugLog('[AUTH][INIT] memory-mode ghost -> signOut()', {
          uid: currentUser.uid,
        });

        await signOut(auth);
        return;
      }

      if (!currentUser) return;

      try {
        await currentUser.reload();

        firebaseDebugLog('[AUTH][INIT] reload ok', {
          uid: currentUser.uid,
          emailVerified: currentUser.emailVerified === true,
        });
      } catch (error: unknown) {
        const code = extractFirebaseErrorCode(error);

        firebaseDebugLog('[AUTH][INIT] reload failed', {
          uid: currentUser.uid,
          code,
        });

        if (INVALID_SESSION_ERROR_CODES.has(code)) {
          await signOut(auth);
        }
      }
    } catch (error: unknown) {
      globalErrorHandler.handleError(normalizeInitializerError(error));
    }
  };
}
