import type { Auth } from '@angular/fire/auth';

import { environment } from '../../../environments/environment';
import { AuthAppBlockService } from '../services/autentication/auth/auth-app-block.service';
import { markAuthInvalidUid, hasAuthInvalidUid, clearAuthInvalidUid } from './auth-invalid-session-marker';
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
  globalErrorHandler: GlobalErrorHandlerService,
  appBlock: AuthAppBlockService
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

      // Revalidacao no Cloud e no emulador. Identidade persistente nao
      // equivale a permissao de acesso se a credencial estiver invalida.
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const restoredUid = currentUser.uid;

      // O marcador, separado por UID, preserva um bloqueio confirmado mesmo
      // quando a pagina e atualizada antes de haver rede para revalidar.
      if (hasAuthInvalidUid(restoredUid)) {
        appBlock.set('auth-invalid');
      }

      if (usingAuthEmulator && persistenceMode === 'memory') {
        // Modo excepcional de QA. Nao executa signOut automatico: impede
        // o uso de uma sessao restaurada incompativel com o modo selecionado.
        markAuthInvalidUid(restoredUid);
        appBlock.set('auth-invalid');
        firebaseDebugLog('[AUTH][INIT] memory-mode restored user blocked', {
          uid: restoredUid,
        });
        return;
      }

      try {
        await currentUser.reload();
        // Nunca desbloquear a conta B por uma resposta atrasada da conta A.
        if (auth.currentUser?.uid !== restoredUid) return;

        clearAuthInvalidUid(restoredUid);
        if (appBlock.snapshot === 'auth-invalid') {
          appBlock.clear();
        }

        firebaseDebugLog('[AUTH][INIT] reload ok', {
          uid: restoredUid,
          emailVerified: currentUser.emailVerified === true,
        });
      } catch (error: unknown) {
        if (auth.currentUser?.uid !== restoredUid) return;
        const code = extractFirebaseErrorCode(error);

        firebaseDebugLog('[AUTH][INIT] reload failed', {
          uid: restoredUid,
          code,
        });

        if (INVALID_SESSION_ERROR_CODES.has(code)) {
          markAuthInvalidUid(restoredUid);
          appBlock.set('auth-invalid');
          return;
        }

        // Oscilacoes de rede nao executam signOut nem apagam bloqueio
        // persistido. A autorizacao no servidor continua obrigatoria.
      }
    } catch (error: unknown) {
      globalErrorHandler.handleError(normalizeInitializerError(error));
    }
  };
}
