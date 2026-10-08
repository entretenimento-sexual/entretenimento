import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';
import { AuthSessionSyncEffects } from './auth-session-sync.effects';

function harness() {
  const ready$ = new BehaviorSubject(false);
  const authUser$ = new BehaviorSubject<{ uid: string; emailVerified: boolean } | null>(null);
  const cache = {
    clearSensitiveSessionCache$: vi.fn(() => of(void 0)),
  };
  const errors = { handleError: vi.fn() };
  const privacy = { log: vi.fn() };
  const session = { ready$, authUser$ };
  const effects = new AuthSessionSyncEffects(
    session as unknown as AuthSessionService,
    errors as unknown as GlobalErrorHandlerService,
    privacy as unknown as PrivacyDebugLoggerService,
    cache as unknown as CacheService
  );
  return { effects, session, cache, errors };
}

describe('AuthSessionSyncEffects - limpeza canônica do cache auxiliar', () => {
  it('limpa no bootstrap, no logout e na troca A→B sem duplicar para o mesmo UID', () => {
    const { effects, session, cache } = harness();
    const actions: unknown[] = [];
    const subscription = effects.syncAuthSession$.subscribe((action) => actions.push(action));

    session.ready$.next(true);
    expect(cache.clearSensitiveSessionCache$).toHaveBeenCalledTimes(1);
    expect(actions.at(-1)).toEqual(authSessionChanged({ uid: null, emailVerified: false }));

    session.authUser$.next({ uid: 'user-a', emailVerified: true });
    expect(cache.clearSensitiveSessionCache$).toHaveBeenCalledTimes(2);

    // A verificação de e-mail pode mudar sem transição de identidade.
    session.authUser$.next({ uid: 'user-a', emailVerified: false });
    expect(cache.clearSensitiveSessionCache$).toHaveBeenCalledTimes(2);

    session.authUser$.next({ uid: 'user-b', emailVerified: true });
    expect(cache.clearSensitiveSessionCache$).toHaveBeenCalledTimes(3);
    expect(actions.at(-1)).toEqual(authSessionChanged({ uid: 'user-b', emailVerified: true }));

    session.authUser$.next(null);
    expect(cache.clearSensitiveSessionCache$).toHaveBeenCalledTimes(4);
    expect(actions.at(-1)).toEqual(authSessionChanged({ uid: null, emailVerified: false }));

    subscription.unsubscribe();
  });

  it('falha de IndexedDB não impede publicação da sessão nem mostra aviso duplicado', () => {
    const { effects, session, cache, errors } = harness();
    cache.clearSensitiveSessionCache$.mockImplementation(
      () => throwError(() => new Error('idb unavailable'))
    );
    const actions: unknown[] = [];
    const subscription = effects.syncAuthSession$.subscribe((action) => actions.push(action));

    session.ready$.next(true);
    session.authUser$.next({ uid: 'user-b', emailVerified: true });

    expect(actions.at(-1)).toEqual(authSessionChanged({ uid: 'user-b', emailVerified: true }));
    expect(errors.handleError).toHaveBeenCalled();
    expect(errors.handleError.mock.calls[0][0]).toMatchObject({
      silent: true,
      skipUserNotification: true,
    });

    subscription.unsubscribe();
  });
});
