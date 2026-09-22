import { describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { UserRepositoryService } from '../../data-handling/firestore/repositories/user-repository.service';

import { AuthAppBlockService } from './auth-app-block.service';
import { AuthOrchestratorService } from './auth-orchestrator.service';
import { AuthPostLoginEffectsService } from './auth-post-login-effects.service';
import { AuthRouteContextService } from './auth-route-context.service';
import { AuthSessionMonitorService } from './auth-session-monitor.service';
import { AuthSessionService } from './auth-session.service';
import { AuthUserDocumentWatchService } from './auth-user-document-watch.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { LogoutService } from './logout.service';

describe('AuthOrchestratorService canonical errors', () => {
  function createHarness(initialUrl = '/dashboard') {
    const applicationError = {
      report: vi.fn(),
    };

    const router = {
      url: initialUrl,
      navigate: vi.fn().mockResolvedValue(true),
    };

    const sessionMonitor = {
      start: vi.fn(),
      stop: vi.fn(),
    };

    const appBlock = {
      set: vi.fn(),
      clear: vi.fn(),
      reason$: { pipe: vi.fn() },
    };

    const service = new AuthOrchestratorService(
      {} as AuthSessionService,
      {} as AuthRouteContextService,
      {} as AuthUserDocumentWatchService,
      sessionMonitor as unknown as AuthSessionMonitorService,
      {} as AuthPostLoginEffectsService,
      {} as UserRepositoryService,
      router as never,
      {} as LogoutService,
      applicationError as unknown as ApplicationErrorService,
      appBlock as unknown as AuthAppBlockService,
      {} as CurrentUserStoreService,
      { log: vi.fn() } as unknown as PrivacyDebugLoggerService
    );

    return {
      applicationError,
      router,
      sessionMonitor,
      appBlock,
      service,
    };
  }

  it('mantém erros internos explicitamente silenciosos', () => {
    const { applicationError, service } = createHarness();
    const error = new Error('watch failed');

    (
      service as unknown as {
        reportSilent(
          error: unknown,
          context: Record<string, unknown>
        ): void;
      }
    ).reportSilent(error, {
      phase: 'userDocumentWatch.subscribe',
      uid: 'user-1',
    });

    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'auth-orchestrator',
      operation: 'userDocumentWatch.subscribe',
      fallbackMessage:
        'Não foi possível concluir uma verificação interna da sessão.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'AuthOrchestratorService',
        phase: 'userDocumentWatch.subscribe',
        uid: 'user-1',
      },
    });
  });

  it('centraliza feedback e diagnóstico do bloqueio em uma única chamada', () => {
    const { applicationError, service } = createHarness('/dashboard');

    (
      service as unknown as {
        notifyAppBlocked(reason: 'forbidden'): void;
      }
    ).notifyAppBlocked('forbidden');

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'App session blocked',
      }),
      {
        feature: 'auth-orchestrator',
        operation: 'blockAppSession',
        fallbackMessage:
          'Sua conta precisa de atenção. Finalize as etapas para continuar.',
        presentation: { surface: 'snackbar', severity: 'error' },
        metadata: {
          scope: 'AuthOrchestratorService',
          reason: 'forbidden',
        },
      }
    );
  });

  it('não apresenta bloqueio durante o fluxo de registro', () => {
    const { applicationError, service } = createHarness('/register/welcome');

    (
      service as unknown as {
        notifyAppBlocked(reason: 'forbidden'): void;
      }
    ).notifyAppBlocked('forbidden');

    expect(applicationError.report).not.toHaveBeenCalled();
  });
});
