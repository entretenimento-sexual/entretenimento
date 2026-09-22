import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

import { AuthSessionMonitorService } from './auth-session-monitor.service';
import { AuthSessionService } from './auth-session.service';
import { LogoutService } from './logout.service';

function createHarness(reloadImpl?: () => Promise<void>) {
  const currentAuthUser = reloadImpl
    ? { reload: vi.fn(reloadImpl) }
    : null;

  const authSession = {
    currentAuthUser,
  };

  const logoutService = {
    hardSignOutToWelcome: vi.fn(),
  };

  const applicationError = {
    report: vi.fn(),
  };

  const privacyDebug = {
    log: vi.fn(),
  };

  const service = new AuthSessionMonitorService(
    authSession as unknown as AuthSessionService,
    logoutService as unknown as LogoutService,
    applicationError as unknown as ApplicationErrorService,
    privacyDebug as unknown as PrivacyDebugLoggerService
  );

  return {
    service,
    authSession,
    logoutService,
    applicationError,
    privacyDebug,
    currentAuthUser,
  };
}

afterEach(() => {
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
      logoutService,
      currentAuthUser,
    } = createHarness(() => Promise.reject(error));

    service.start();

    await vi.advanceTimersByTimeAsync(600_000);

    expect(currentAuthUser?.reload).toHaveBeenCalledTimes(1);
    expect(logoutService.hardSignOutToWelcome).not.toHaveBeenCalled();
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

  it('faz hard sign-out para token inválido sem reportar como falha interna', async () => {
    vi.useFakeTimers();

    const error = Object.assign(new Error('token expired'), {
      code: 'auth/user-token-expired',
    });

    const {
      service,
      applicationError,
      logoutService,
      currentAuthUser,
    } = createHarness(() => Promise.reject(error));

    service.start();

    await vi.advanceTimersByTimeAsync(600_000);

    expect(currentAuthUser?.reload).toHaveBeenCalledTimes(1);
    expect(logoutService.hardSignOutToWelcome).toHaveBeenCalledTimes(1);
    expect(logoutService.hardSignOutToWelcome).toHaveBeenCalledWith(
      'auth-invalid'
    );
    expect(applicationError.report).not.toHaveBeenCalled();

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
