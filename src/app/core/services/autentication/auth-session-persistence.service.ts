// Política única de duração da sessão para senha e provedores sociais.
// Uma persistência não confirmada impede o login: não há fallback silencioso.
import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
  type Persistence,
} from 'firebase/auth';
import { Observable, defer, throwError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';
import {
  getFirebaseEmulatorEndpoint,
  resolveFirebaseAuthEmulatorPersistenceMode,
} from '@core/firebase/firebase-environment.config';

export type AuthSessionMode = 'local' | 'session' | 'none';

export function resolveAuthSessionPersistence(
  mode: AuthSessionMode,
  emulatorMode: 'session' | 'memory' | null = null
): Persistence {
  if (emulatorMode !== null) {
    return emulatorMode === 'session'
      ? browserSessionPersistence
      : inMemoryPersistence;
  }

  switch (mode) {
    case 'local': return browserLocalPersistence;
    case 'session': return browserSessionPersistence;
    case 'none': return inMemoryPersistence;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthSessionPersistenceService {
  private readonly auth = inject(Auth);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly netTimeoutMs = 12_000;

  setSessionPersistence$(
    modeOrPersistence: AuthSessionMode | Persistence
  ): Observable<void> {
    return defer(() => {
      const emulatorMode = getFirebaseEmulatorEndpoint('auth')
        ? resolveFirebaseAuthEmulatorPersistenceMode()
        : null;
      const persistence = typeof modeOrPersistence === 'string'
        ? resolveAuthSessionPersistence(modeOrPersistence, emulatorMode)
        : emulatorMode
          ? resolveAuthSessionPersistence('none', emulatorMode)
          : modeOrPersistence;

      return runInInjectionContext(this.envInjector, () =>
        setPersistence(this.auth, persistence)
      );
    }).pipe(
      timeout({ first: this.netTimeoutMs }),
      map(() => void 0),
      catchError((cause: unknown) => {
        const error = new Error(
          'Não foi possível configurar a duração da sessão neste navegador.'
        ) as Error & { code: string; cause?: unknown; skipUserNotification: boolean };
        error.code = 'auth/persistence-unavailable';
        error.cause = cause;
        error.skipUserNotification = true;
        return throwError(() => error);
      })
    );
  }
}
