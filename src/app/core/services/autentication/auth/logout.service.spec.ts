import {
  EMPTY,
  NEVER,
  Subject,
  defer,
  firstValueFrom,
  of,
  throwError,
} from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LogoutService } from './logout.service';

type PushMode = 'success' | 'error' | 'empty' | 'never';
type CleanupMode = 'success' | 'never';
type SignOutMode = 'success' | 'error';

interface HarnessOptions {
  presenceMode?: CleanupMode;
  pushMode?: PushMode;
  cacheMode?: CleanupMode;
  signOutMode?: SignOutMode;
}

const originalNotification = Object.getOwnPropertyDescriptor(
  globalThis,
  'Notification'
);

function createHarness(options: HarnessOptions = {}) {
  const presenceMode = options.presenceMode ?? 'success';
  const pushMode = options.pushMode ?? 'success';
  const cacheMode = options.cacheMode ?? 'success';
  const signOutMode = options.signOutMode ?? 'success';
  const calls: string[] = [];
  let terminating = false;

  const auth = {
    currentUser: { uid: 'user-a' } as { uid: string } | null,
  };

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

        if (presenceMode === 'never') {
          return NEVER;
        }

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
    state$: of('active' as const),
    deactivate$: vi.fn(() =>
      defer(() => {
        calls.push('push');

        if (pushMode === 'error') {
          return throwError(() => new Error('push unavailable'));
        }

        if (pushMode === 'empty') {
          return EMPTY;
        }

        if (pushMode === 'never') {
          return NEVER;
        }

        return of('inactive' as const);
      })
    ),
    activate$: vi.fn(() =>
      defer(() => {
        calls.push('push:restore');
        return of('active' as const);
      })
    ),
  };

  const currentUserStore = {
    clear: vi.fn(),
  };

  const appBlock = {
    clear: vi.fn(),
  };

  const authSession = {
    beginTermination: vi.fn(() => {
      terminating = true;
      calls.push('session:begin');
    }),
    endTermination: vi.fn(() => {
      terminating = false;
      calls.push('session:end');
    }),
    get isTerminatingSnapshot() {
      return terminating;
    },
  };

  const applicationError = {
    report: vi.fn(),
  };

  const privacyDebug = {
    log: vi.fn(),
  };

  const cache = {
    clearSensitiveSessionCache$: vi.fn(() =>
      defer(() => {
        calls.push('cache');

        if (cacheMode === 'never') {
          return NEVER;
        }

        return of(void 0);
      })
    ),
  };

  const service = new LogoutService(
    auth as any,
    router as any,
    presence as any,
    geolocation as any,
    pushNotifications as any,
    currentUserStore as any,
    appBlock as any,
    authSession as any,
    applicationError as any,
    {} as any,
    privacyDebug as any,
    cache as any
  );

  const executeSignOut = vi.fn((mode: string) =>
    defer(() => {
      calls.push(`signout:${mode}`);

      if (signOutMode === 'error' && mode === 'strict') {
        return throwError(() => new Error('signout unavailable'));
      }

      auth.currentUser = null;
      return of(void 0);
    })
  );
  (service as any).executeSignOut$ = executeSignOut;

  return {
    service,
    auth,
    calls,
    router,
    presence,
    pushNotifications,
    cache,
    currentUserStore,
    appBlock,
    authSession,
    applicationError,
    executeSignOut,
  };
}

afterEach(() => {
  vi.useRealTimers();

  if (originalNotification) {
    Object.defineProperty(globalThis, 'Notification', originalNotification);
  } else {
    Reflect.deleteProperty(globalThis, 'Notification');
  }
});

describe('LogoutService global session lifecycle', () => {
  it('encerra recursos, sessão e dados locais em uma única ordem canônica', async () => {
    const {
      service,
      calls,
      pushNotifications,
      currentUserStore,
      appBlock,
      authSession,
    } = createHarness();

    await firstValueFrom(service.logout$());

    expect(calls).toEqual([
      'session:begin',
      'geolocation',
      'presence',
      'push',
      'signout:strict',
      'cache',
      'navigate',
      'session:end',
    ]);
    expect(pushNotifications.deactivate$).toHaveBeenCalledTimes(1);
    expect(currentUserStore.clear).toHaveBeenCalledTimes(1);
    expect(appBlock.clear).toHaveBeenCalledTimes(1);
    expect(authSession.beginTermination).toHaveBeenCalledTimes(1);
    expect(authSession.endTermination).toHaveBeenCalledTimes(1);
  });

  it('compartilha a mesma operação entre chamadores concorrentes', async () => {
    const { service, calls } = createHarness();
    const signOutGate = new Subject<void>();

    const executeSignOut = vi.fn((mode: string) =>
      defer(() => {
        calls.push(`signout:${mode}`);
        return signOutGate.asObservable();
      })
    );
    (service as any).executeSignOut$ = executeSignOut;

    const first$ = service.logout$();
    const second$ = service.logout$();
    expect(second$).toBe(first$);

    const firstDone = firstValueFrom(first$);
    const secondDone = firstValueFrom(second$);

    expect(executeSignOut).toHaveBeenCalledTimes(1);

    signOutGate.next();
    signOutGate.complete();

    await Promise.all([firstDone, secondDone]);
    expect(executeSignOut).toHaveBeenCalledTimes(1);
  });

  it('restaura a sessão operacional e Web Push se o signOut estrito falhar', async () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'granted' },
    });

    const {
      service,
      calls,
      auth,
      pushNotifications,
      currentUserStore,
      applicationError,
    } = createHarness({ signOutMode: 'error' });

    await expect(firstValueFrom(service.logout$())).rejects.toThrow(
      'signout unavailable'
    );

    expect(auth.currentUser?.uid).toBe('user-a');
    expect(calls).toEqual([
      'session:begin',
      'geolocation',
      'presence',
      'push',
      'signout:strict',
      'session:end',
      'push:restore',
    ]);
    expect(pushNotifications.activate$).toHaveBeenCalledTimes(1);
    expect(currentUserStore.clear).not.toHaveBeenCalled();
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('falha do Web Push é reportada silenciosamente e não bloqueia o logout', async () => {
    const { service, calls, applicationError } = createHarness({
      pushMode: 'error',
    });

    await firstValueFrom(service.logout$());

    expect(calls).toContain('signout:strict');
    expect(calls).toContain('cache');
    expect(calls).toContain('navigate');
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'push unavailable',
      }),
      {
        feature: 'auth',
        operation: 'deactivatePushBestEffort$',
        fallbackMessage:
          'Não foi possível concluir uma etapa interna do encerramento da sessão.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'LogoutService',
          phase: 'deactivatePushBestEffort$',
        },
      }
    );
  });

  it('Observable vazio do cleanup de Web Push não encerra a cadeia de logout', async () => {
    const { service, calls } = createHarness({ pushMode: 'empty' });

    await firstValueFrom(service.logout$());

    expect(calls).toContain('signout:strict');
    expect(calls).toContain('navigate');
  });

  it('cleanups best-effort que nunca completam não prendem o logout', async () => {
    vi.useFakeTimers();

    const { service, calls, applicationError } = createHarness({
      presenceMode: 'never',
      pushMode: 'never',
      cacheMode: 'never',
    });

    const done = firstValueFrom(service.logout$());

    await vi.runAllTimersAsync();
    await done;

    expect(calls).toEqual([
      'session:begin',
      'geolocation',
      'presence',
      'push',
      'signout:strict',
      'cache',
      'navigate',
      'session:end',
    ]);
    expect(applicationError.report).toHaveBeenCalledTimes(3);
    expect(applicationError.report).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: '[LogoutService] best-effort cleanup timeout',
      }),
      expect.objectContaining({
        feature: 'auth',
        operation: 'stopPresenceBestEffort$',
        presentation: { surface: 'none', severity: 'error' },
      })
    );
    expect(applicationError.report).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: '[LogoutService] best-effort cleanup timeout',
      }),
      expect.objectContaining({
        feature: 'auth',
        operation: 'deactivatePushBestEffort$',
        presentation: { surface: 'none', severity: 'error' },
      })
    );
    expect(applicationError.report).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        message: '[LogoutService] best-effort cleanup timeout',
      }),
      expect.objectContaining({
        feature: 'auth',
        operation: 'clearLocalSessionDataBestEffort$',
        presentation: { surface: 'none', severity: 'error' },
      })
    );
  });

  it('hard signout usa o mesmo lifecycle e centraliza o aviso de sessão encerrada', async () => {
    const { service, calls, applicationError, authSession } = createHarness();

    await firstValueFrom(service.hardSignOutToWelcome$('auth-invalid'));

    expect(calls).toEqual([
      'session:begin',
      'geolocation',
      'presence',
      'push',
      'signout:best-effort',
      'cache',
      'navigate',
      'session:end',
    ]);
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Hard sign-out initiated',
      }),
      {
        feature: 'auth',
        operation: 'hardSignOutToWelcome',
        fallbackMessage:
          'Sua sessão foi encerrada. Faça login novamente.',
        presentation: { surface: 'snackbar', severity: 'error' },
        metadata: {
          scope: 'LogoutService',
          reason: 'auth-invalid',
          expectedTermination: true,
        },
      }
    );
    expect(authSession.beginTermination).toHaveBeenCalledTimes(1);
    expect(authSession.endTermination).toHaveBeenCalledTimes(1);
  });

  it('não apresenta aviso de hard signout durante o fluxo de registro', async () => {
    const { service, router, applicationError } = createHarness();
    router.url = '/register/welcome';

    await firstValueFrom(service.hardSignOutToWelcome$('auth-invalid'));

    expect(applicationError.report).not.toHaveBeenCalled();
  });
});
