import { BehaviorSubject, NEVER, Subject, of } from 'rxjs';
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
      invalidationSnapshot: null as { uid: string; reason: string } | null,
    };

    const authSession = {
      currentAuthUser: { uid: 'user-a' },
      isTerminatingSnapshot: false,
    };
    const userRepo = { confirmUserDocMissing$: vi.fn() };
    const service = new AuthOrchestratorService(
      authSession as unknown as AuthSessionService,
      {} as AuthRouteContextService,
      {} as AuthUserDocumentWatchService,
      sessionMonitor as unknown as AuthSessionMonitorService,
      {} as AuthPostLoginEffectsService,
      userRepo as unknown as UserRepositoryService,
      router as never,
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
      authSession,
      userRepo,
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

  it('mantém documentos públicos disponíveis com cadastro incompleto e protege a navegação interna', () => {
    const route = (url: string) => ({
      currentUrl: url,
      navPath: url.split(/[?#]/)[0],
      routerReady: true,
      inRegistrationFlow: false,
    });
    const routes = new BehaviorSubject(route('/termos-e-condicoes?origem=cadastro'));
    const router = { url: routes.value.currentUrl, navigate: vi.fn().mockResolvedValue(true) };
    const watch$ = vi.fn(() => NEVER);
    const sessionMonitor = { start: vi.fn(), stop: vi.fn() };
    const user$ = of({ uid: 'a', accountStatus: 'active', interactionBlocked: true, profileCompleted: false });

    new AuthOrchestratorService(
      { ready$: of(true), authUser$: of({ uid: 'a', emailVerified: true }) } as unknown as AuthSessionService,
      { context$: routes } as unknown as AuthRouteContextService,
      { watch$ } as unknown as AuthUserDocumentWatchService,
      sessionMonitor as unknown as AuthSessionMonitorService,
      { run$: () => of(null) } as unknown as AuthPostLoginEffectsService,
      {} as UserRepositoryService,
      router as never,
      { report: vi.fn() } as unknown as ApplicationErrorService,
      new AuthAppBlockService(),
      { user$ } as unknown as CurrentUserStoreService,
      { log: vi.fn() } as unknown as PrivacyDebugLoggerService
    ).start();

    for (const path of ['/politica-de-privacidade#privacy-title', '/politica-de-cookies/']) {
      router.url = path;
      routes.next(route(path));
    }
    expect(router.navigate).not.toHaveBeenCalled();
    expect(watch$).not.toHaveBeenCalled();
    expect(sessionMonitor.start).not.toHaveBeenCalled();

    router.url = '/dashboard/explorar';
    routes.next(route(router.url));
    expect(router.navigate).toHaveBeenCalledExactlyOnceWith(['/conta/status'], { replaceUrl: true });
  });
  it('preserva bloqueio inicial e limpa na troca real de UID', () => {
    const { service, appBlock } = createHarness();
    const target = service as unknown as {
      handleUidChange(uid: string): void;
    };

    target.handleUidChange('user-a');
    expect(appBlock.clear).not.toHaveBeenCalled();

    target.handleUidChange('user-b');
    expect(appBlock.clear).toHaveBeenCalledTimes(1);
  });

  it('preserva o bloqueio técnico da conta que está entrando', () => {
    const { service, appBlock } = createHarness();
    const target = service as unknown as { handleUidChange(uid: string): void };
    target.handleUidChange('user-a');
    appBlock.invalidationSnapshot = { uid: 'user-b', reason: 'session-disabled' };

    target.handleUidChange('user-b');

    expect(appBlock.clear).not.toHaveBeenCalled();
  });

  it('descarta confirmação obsoleta após troca de conta ou de sessão do mesmo UID', async () => {
    for (const nextUid of ['user-b', 'user-a']) {
      const { service, authSession, userRepo, appBlock } = createHarness();
      const result$ = new Subject<boolean>();
      userRepo.confirmUserDocMissing$.mockReturnValue(result$);
      const target = service as unknown as {
        sawUserDocOnce: boolean;
        handleUidChange(uid: string): void;
        handleNoAuthUser(): void;
        confirmAndSignOutIfMissing(uid: string, reason: 'deleted'): Promise<void>;
      };
      target.handleUidChange('user-a');
      target.sawUserDocOnce = true;
      const confirmation = target.confirmAndSignOutIfMissing('user-a', 'deleted');
      expect(userRepo.confirmUserDocMissing$).toHaveBeenCalledWith('user-a');

      if (nextUid === 'user-a') target.handleNoAuthUser();
      authSession.currentAuthUser = { uid: nextUid };
      target.handleUidChange(nextUid);
      result$.next(true);
      await confirmation;

      expect(appBlock.set).not.toHaveBeenCalled();
    }
  });

  it('continua processando trocas de conta após falha em um contexto', () => {
    const users = new BehaviorSubject({ uid: 'a', emailVerified: true });
    const routes = new BehaviorSubject({
      currentUrl: '/dashboard',
      navPath: '/dashboard',
      routerReady: true,
      inRegistrationFlow: false,
    });
    const profiles = new BehaviorSubject({ uid: 'a', accountStatus: 'active' });
    const watch$ = vi.fn(() => NEVER);
    const error = new Error('Falha na ativação do monitor');
    const sessionMonitor = {
      start: vi.fn().mockImplementationOnce(() => { throw error; }),
      stop: vi.fn(),
    };
    const applicationError = { report: vi.fn() };
    const service = new AuthOrchestratorService(
      { ready$: of(true), authUser$: users } as unknown as AuthSessionService,
      { context$: routes } as unknown as AuthRouteContextService,
      { watch$ } as unknown as AuthUserDocumentWatchService,
      sessionMonitor as unknown as AuthSessionMonitorService,
      { run$: () => of(null) } as unknown as AuthPostLoginEffectsService,
      {} as UserRepositoryService,
      { url: '/dashboard' } as never,
      applicationError as unknown as ApplicationErrorService,
      new AuthAppBlockService(),
      { user$: profiles } as unknown as CurrentUserStoreService,
      { log: vi.fn() } as unknown as PrivacyDebugLoggerService
    );

    service.start();
    expect(applicationError.report).toHaveBeenCalledWith(error,
      expect.objectContaining({ operation: 'start.context' }));
    expect(watch$).not.toHaveBeenCalled();

    users.next({ uid: 'b', emailVerified: true });
    profiles.next({ uid: 'b', accountStatus: 'active' });
    expect(watch$).toHaveBeenCalledWith('b');
  });

  it('bloqueia um documento confirmado como ausente quando a sessão permanece atual', async () => {
    const { service, userRepo, appBlock } = createHarness();
    const result$ = new Subject<boolean>();
    userRepo.confirmUserDocMissing$.mockReturnValue(result$);
    const target = service as unknown as {
      sawUserDocOnce: boolean;
      handleUidChange(uid: string): void;
      confirmAndSignOutIfMissing(uid: string, reason: 'deleted'): Promise<void>;
    };
    target.handleUidChange('user-a');
    target.sawUserDocOnce = true;
    const confirmation = target.confirmAndSignOutIfMissing('user-a', 'deleted');
    result$.next(true);
    await confirmation;
    expect(appBlock.set).toHaveBeenCalledWith('deleted');
  });

});
