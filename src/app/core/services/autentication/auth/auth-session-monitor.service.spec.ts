import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

import { AuthSessionMonitorService } from './auth-session-monitor.service';
import type { Auth } from '@angular/fire/auth';
import { AuthSessionService } from './auth-session.service';
import { AuthAppBlockService } from './auth-app-block.service';

function createHarness(reloadImpl?: () => Promise<void>) {
  const currentAuthUser = reloadImpl
    ? { uid: 'user-a', reload: vi.fn(reloadImpl) }
    : null;

  const auth = { currentUser: currentAuthUser };
  const appBlock = new AuthAppBlockService();
  vi.spyOn(appBlock, 'set');

  const applicationError = {
    report: vi.fn(),
  };

  const privacyDebug = {
    log: vi.fn(),
  };

  const authSession = new AuthSessionService(
    auth as unknown as Auth, privacyDebug as unknown as PrivacyDebugLoggerService, appBlock
  );
  const service = new AuthSessionMonitorService(
    authSession,
    applicationError as unknown as ApplicationErrorService,
    privacyDebug as unknown as PrivacyDebugLoggerService
  );

  return {
    service,
    authSession,
    auth,
    appBlock,
    applicationError,
    privacyDebug,
    currentAuthUser,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('AuthSessionMonitorService canonical errors', () => {
  it('reporta falha transitória de reload de forma explicitamente silenciosa', async () => {
    vi.useFakeTimers();

    const error = Object.assign(new Error('network failure'), {
      code: 'auth/network-request-failed',
    });

    const {
      service,
      applicationError,
      appBlock,
      currentAuthUser,
    } = createHarness(() => Promise.reject(error));

    service.start();

    await vi.advanceTimersByTimeAsync(600_000);

    expect(currentAuthUser?.reload).toHaveBeenCalledTimes(1);
    expect(appBlock.set).not.toHaveBeenCalled();
    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'auth-session-monitor',
      operation: 'session-monitor.reload',
      fallbackMessage:
        'Não foi possível concluir uma verificação técnica da sessão.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'AuthSessionMonitorService',
        phase: 'session-monitor.reload',
        code: 'auth/network-request-failed',
      },
    });

    service.stop();
  });

  it('bloqueia acesso por token invalido sem logout', async () => {
    vi.useFakeTimers();

    const error = Object.assign(new Error('token expired'), {
      code: 'auth/user-token-expired',
    });

    const {
      service,
      applicationError,
      appBlock,
      currentAuthUser,
    } = createHarness(() => Promise.reject(error));

    service.start();

    await vi.advanceTimersByTimeAsync(600_000);

    expect(currentAuthUser?.reload).toHaveBeenCalledTimes(1);
    expect(appBlock.set).toHaveBeenCalledTimes(1);
    expect(appBlock.set).toHaveBeenCalledWith(
      'auth-invalid'
    );
    expect(applicationError.report).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        feature: 'auth-session-monitor',
        operation: 'session-monitor.invalid',
        presentation: {
          surface: 'none',
          severity: 'error',
        },
      })
    );

    service.stop();
  });

  it('não executa reload técnico durante o encerramento voluntário', async () => {
    vi.useFakeTimers();
    const { service, authSession, currentAuthUser, appBlock } =
      createHarness(() => Promise.reject(new Error('stale token')));
    authSession.beginTermination();

    service.start();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(currentAuthUser?.reload).not.toHaveBeenCalled();
    expect(appBlock.set).not.toHaveBeenCalled();
    service.stop();
  });

  it('ignora invalidação assíncrona de A após troca direta para B', async () => {
    vi.useFakeTimers();
    let rejectReload!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectReload = reject;
    });

    const { service, auth, appBlock, applicationError } =
      createHarness(() => pending);
    service.start();
    await vi.advanceTimersByTimeAsync(600_000);

    auth.currentUser = {
      uid: 'user-b',
      reload: vi.fn().mockResolvedValue(undefined),
    };
    rejectReload(Object.assign(new Error('old token expired'), {
      code: 'auth/user-token-expired',
    }));
    await vi.advanceTimersByTimeAsync(0);

    expect(appBlock.set).not.toHaveBeenCalled();
    expect(applicationError.report).not.toHaveBeenCalled();
    service.stop();
  });

  it('registra causa mesmo se o SDK limpar o usuário e a aplicação parar o monitor', async () => {
    vi.useFakeTimers();
    const t = createHarness(async () => {
      t.auth.currentUser = null;
      t.service.stop();
      throw Object.assign(new Error('expired'), { code: 'auth/user-token-expired' });
    });
    t.service.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(t.appBlock.invalidationSnapshot).toEqual({ uid: 'user-a', reason: 'session-expired' });
    expect(t.appBlock.snapshot).toBeNull();
  });

  it('ignora invalidação que chega após o início do logout', async () => {
    vi.useFakeTimers();
    let rejectReload!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectReload = reject;
    });

    const { service, authSession, appBlock } = createHarness(() => pending);
    service.start();
    await vi.advanceTimersByTimeAsync(600_000);

    authSession.beginTermination();
    rejectReload(Object.assign(new Error('old token expired'), {
      code: 'auth/user-token-expired',
    }));
    await vi.advanceTimersByTimeAsync(0);

    expect(appBlock.set).not.toHaveBeenCalled();
    service.stop();
  });

  it('mantém diagnóstico secundário fail-safe se a camada canônica falhar', () => {
    const { service, applicationError } = createHarness();

    applicationError.report.mockImplementation(() => {
      throw new Error('diagnostic unavailable');
    });

    expect(() =>
      (
        service as unknown as {
          reportSilent(
            error: unknown,
            context: Record<string, unknown>
          ): void;
        }
      ).reportSilent(new Error('source'), {
        phase: 'session-monitor.pipeline',
      })
    ).not.toThrow();
  });
});
