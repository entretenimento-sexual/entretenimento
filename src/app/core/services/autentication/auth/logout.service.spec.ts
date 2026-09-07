import { EMPTY, defer, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LogoutService } from './logout.service';

type PushMode = 'success' | 'error' | 'empty';

function createHarness(pushMode: PushMode = 'success') {
  const calls: string[] = [];

  const router = {
    url: '/home',
    navigate: vi.fn(() => {
      calls.push('navigate');
      return Promise.resolve(true);
    }),
  };

  const presence = {
    stop$: vi.fn(() =>
      defer(() => {
        calls.push('presence');
        return of(void 0);
      })
    ),
  };

  const geolocation = {
    stopTracking: vi.fn(() => {
      calls.push('geolocation');
    }),
  };

  const pushNotifications = {
    deactivate$: vi.fn(() =>
      defer(() => {
        calls.push('push');

        if (pushMode === 'error') {
          return throwError(() => new Error('push unavailable'));
        }

        if (pushMode === 'empty') {
          return EMPTY;
        }

        return of('inactive' as const);
      })
    ),
  };

  const currentUserStore = {
    clear: vi.fn(),
  };

  const appBlock = {
    clear: vi.fn(),
  };

  const globalErrorHandler = {
    handleError: vi.fn(),
  };

  const errorNotifier = {
    showError: vi.fn(),
  };

  const privacyDebug = {
    log: vi.fn(),
  };

  const cache = {
    clearSensitiveSessionCache$: vi.fn(() =>
      defer(() => {
        calls.push('cache');
        return of(void 0);
      })
    ),
  };

  const service = new LogoutService(
    {} as any,
    router as any,
    presence as any,
    geolocation as any,
    pushNotifications as any,
    currentUserStore as any,
    appBlock as any,
    globalErrorHandler as any,
    errorNotifier as any,
    {} as any,
    privacyDebug as any,
    cache as any
  );

  const executeSignOut = vi.fn((mode: string) =>
    defer(() => {
      calls.push(`signout:${mode}`);
      return of(void 0);
    })
  );
  (service as any).executeSignOut$ = executeSignOut;

  return {
    service,
    calls,
    pushNotifications,
    globalErrorHandler,
    errorNotifier,
  };
}

describe('LogoutService Web Push lifecycle', () => {
  it('remove Web Push antes do signOut no logout voluntário', async () => {
    const { service, calls, pushNotifications } = createHarness();

    await firstValueFrom(service.logout$());

    expect(calls).toEqual([
      'geolocation',
      'presence',
      'push',
      'signout:strict',
      'cache',
      'navigate',
    ]);
    expect(pushNotifications.deactivate$).toHaveBeenCalledTimes(1);
  });

  it('falha do Web Push é reportada silenciosamente e não bloqueia o logout', async () => {
    const { service, calls, globalErrorHandler } = createHarness('error');

    await firstValueFrom(service.logout$());

    expect(calls).toEqual([
      'geolocation',
      'presence',
      'push',
      'signout:strict',
      'cache',
      'navigate',
    ]);
    expect(globalErrorHandler.handleError).toHaveBeenCalledTimes(1);
  });

  it('Observable vazio do cleanup de Web Push não encerra a cadeia de logout', async () => {
    const { service, calls } = createHarness('empty');

    await firstValueFrom(service.logout$());

    expect(calls).toContain('signout:strict');
    expect(calls).toContain('navigate');
  });

  it('hard signout também tenta remover Web Push antes do signOut best-effort', async () => {
    const { service, calls, errorNotifier } = createHarness();

    await firstValueFrom(service.hardSignOutToWelcome$('auth-invalid'));

    expect(calls).toEqual([
      'geolocation',
      'presence',
      'push',
      'signout:best-effort',
      'cache',
      'navigate',
    ]);
    expect(errorNotifier.showError).toHaveBeenCalledWith(
      'Sua sessão foi encerrada. Faça login novamente.'
    );
  });
});
