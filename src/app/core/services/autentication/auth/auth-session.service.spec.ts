import type { Auth } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FIREBASE_AUTH_RESTORE_TIMEOUT_MS } from '@core/firebase/firebase-runtime.constants';
import type { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthSessionService } from './auth-session.service';

describe('AuthSessionService e recuperação transitória', () => {
  const user = (uid: string) => ({
    uid,
    emailVerified: false,
    reload: vi.fn().mockResolvedValue(undefined),
    getIdToken: vi.fn().mockResolvedValue('token'),
  });

  function setup() {
    const auth = {
      currentUser: user('a'),
      authStateReady: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AuthSessionService(
      auth as unknown as Auth,
      { log: vi.fn() } as unknown as PrivacyDebugLoggerService,
      new AuthAppBlockService()
    );
    return { auth, service };
  }

  afterEach(() => vi.useRealTimers());

  it('limita a espera de cada chamada, reaproveita a inicialização e publica o estado tardio', async () => {
    vi.useFakeTimers();
    const { auth, service } = setup();
    let resolveReady!: () => void;
    auth.authStateReady.mockReturnValue(new Promise<void>((resolve) => { resolveReady = resolve; }));

    const states: boolean[] = [];
    const sub = service.ready$.subscribe((ready) => states.push(ready));
    const firstDeadline = expect(service.whenReady()).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(FIREBASE_AUTH_RESTORE_TIMEOUT_MS);
    await firstDeadline;
    expect(states).toEqual([false]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(auth.authStateReady).toHaveBeenCalledOnce();
    resolveReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([false, true]);
    sub.unsubscribe();
  });

  it('restaura a sessão pelo listener nativo quando authStateReady não existe', async () => {
    let notify!: (value: unknown) => void;
    const unsubscribe = vi.fn();
    const auth = {
      currentUser: user('a'),
      onAuthStateChanged: vi.fn((next: (value: unknown) => void) => {
        notify = next;
        return unsubscribe;
      }),
    };
    const service = new AuthSessionService(
      auth as unknown as Auth,
      { log: vi.fn() } as unknown as PrivacyDebugLoggerService,
      new AuthAppBlockService()
    );

    const pending = service.whenReady();
    expect(service.whenReady()).toBe(pending);
    expect(auth.onAuthStateChanged).toHaveBeenCalledOnce();
    notify(auth.currentUser);
    await expect(pending).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(service.currentAuthUser).toBe(auth.currentUser);
  });

  it.each(['reload', 'getIdToken'] as const)('separa erro em %s de um e-mail pendente', async (operation) => {
    const { auth, service } = setup();
    const active = auth.currentUser;
    const offline = Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
    active[operation].mockRejectedValue(offline);

    await expect(firstValueFrom(service.refreshCurrentUser$({ requireFresh: true }))).rejects.toBe(offline);
    expect(auth.currentUser).toBe(active);
    await expect(firstValueFrom(service.refreshCurrentUser$())).resolves.toBe(active);
  });

  it('descarta o refresh depois da troca de conta', async () => {
    const { auth, service } = setup();
    const previous = auth.currentUser;
    let resolveReload!: () => void;
    previous.reload.mockReturnValue(new Promise<void>((resolve) => { resolveReload = resolve; }));

    const pending = firstValueFrom(service.refreshCurrentUser$({ requireFresh: true }));
    await Promise.resolve();
    auth.currentUser = user('b');
    resolveReload();
    await expect(pending).resolves.toBeNull();
    expect(previous.getIdToken).not.toHaveBeenCalled();
  });
});
