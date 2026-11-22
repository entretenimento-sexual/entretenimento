import type { Auth } from '@angular/fire/auth';
import { firstValueFrom, from, timeout } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthAppBlockService } from '../services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from '../services/autentication/auth/auth-session.service';
import { FIREBASE_AUTH_RESTORE_TIMEOUT_MS } from './firebase-runtime.constants';
import { readAuthInvalidUid } from './auth-invalid-session-marker';
import { clearPendingLogout, readPendingLogout } from './pending-logout';
import { authInvalidationReason } from '../services/autentication/auth/auth.types';
import { GlobalErrorHandlerService } from '../services/error-handler/global-error-handler.service';
import {
  firebaseDebugLog,
  getFirebaseEmulatorEndpoint,
  resolveFirebaseAuthEmulatorPersistenceMode,
} from './firebase-environment.config';

type AuthWithOptionalStateReady = Auth & {
  authStateReady?: () => Promise<void>;
};

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
  appBlock: AuthAppBlockService,
  session: AuthSessionService,
  resumeLogout?: () => Promise<void>
): () => Promise<void> {
  return async (): Promise<void> => {
    // A espera da casca tem limite. Se o SDK hidratar mais tarde, a
    // identidade que ele restaurar ainda passa pela política de bootstrap.
    const termination = session.terminationVersionSnapshot;
    const restore = Promise.resolve().then(async () => {
      await (auth as AuthWithOptionalStateReady).authStateReady?.();
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
      const pendingLogout = readPendingLogout();
      if (pendingLogout && session.terminationVersionSnapshot === termination && resumeLogout) {
        if (pendingLogout === currentUser?.uid) {
          await resumeLogout();
          return;
        }
        clearPendingLogout(pendingLogout);
      }
      if (!currentUser || session.terminationVersionSnapshot !== termination) return;
      const restoredUid = currentUser.uid;

      // O marcador, separado por UID, preserva um bloqueio confirmado mesmo
      // quando a pagina e atualizada antes de haver rede para revalidar.
      const savedReason = readAuthInvalidUid(restoredUid);
      if (savedReason) appBlock.applyInvalidation(restoredUid, savedReason, true);

      if (usingAuthEmulator && persistenceMode === 'memory') {
        // Modo excepcional de QA. Nao executa signOut automatico: impede
        // o uso de uma sessao restaurada incompativel com o modo selecionado.
        appBlock.recordInvalidation(restoredUid, 'session-expired', true);
        firebaseDebugLog('[AUTH][INIT] memory-mode restored user blocked', {
          uid: restoredUid,
        });
        return;
      }

      try {
        const reload = Promise.resolve().then(() => currentUser.reload()).catch((error: unknown) => {
          session.recordReloadFailure(currentUser, termination, error);
          throw error;
        });
        await reload;
        if (auth.currentUser !== currentUser || session.terminationVersionSnapshot !== termination ||
            session.isTerminatingSnapshot) return;
        appBlock.resolveInvalidation(restoredUid);

        firebaseDebugLog('[AUTH][INIT] reload ok', {
          uid: restoredUid,
          emailVerified: currentUser.emailVerified === true,
        });
      } catch (error: unknown) {
        if (session.terminationVersionSnapshot !== termination) return;
        const active = auth.currentUser;
        if (active && (active !== currentUser || active.uid !== restoredUid)) return;
        const reason = authInvalidationReason(error);

        firebaseDebugLog('[AUTH][INIT] reload failed', {
          uid: restoredUid,
          reason,
        });

        // Oscilacoes de rede nao executam signOut nem apagam bloqueio
        // persistido. A autorizacao no servidor continua obrigatoria.
      }
    });

    const report = (error: unknown) => {
      globalErrorHandler.handleError(Object.assign(normalizeInitializerError(error), {
        silent: true,
        context: 'authRestoreInitializer',
      }));
    };
    try {
      await firstValueFrom(from(restore.catch(report)).pipe(
        timeout({ first: FIREBASE_AUTH_RESTORE_TIMEOUT_MS })
      ));
    } catch (error: unknown) {
      report(error);
    }
  };
}
