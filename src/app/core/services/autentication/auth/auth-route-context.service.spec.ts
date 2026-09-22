import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '../../error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { AuthRouteContextService } from './auth-route-context.service';

describe('AuthRouteContextService canonical errors', () => {
  let routerEvents$: Subject<unknown>;
  let routerMock: {
    events: Subject<unknown>;
    url: string;
    navigated: boolean;
  };
  let report: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    routerEvents$ = new Subject<unknown>();
    routerMock = {
      events: routerEvents$,
      url: '/login?from=%2Fdashboard#top',
      navigated: false,
    };
    report = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        AuthRouteContextService,
        {
          provide: Router,
          useValue: routerMock,
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });
  });

  it('expõe snapshot inicial coeso antes do Router estar pronto', async () => {
    const service = TestBed.inject(AuthRouteContextService);

    await expect(firstValueFrom(service.context$)).resolves.toEqual({
      routerReady: false,
      currentUrl: '/login?from=%2Fdashboard#top',
      navPath: null,
      inRegistrationFlow: true,
    });

    expect(report).not.toHaveBeenCalled();
  });

  it('normaliza NavigationEnd e deriva corretamente o contexto de rota', async () => {
    routerMock.url = '/';
    routerMock.navigated = false;
    const service = TestBed.inject(AuthRouteContextService);

    const emitted: unknown[] = [];
    const subscription = service.context$.subscribe((value) => emitted.push(value));

    routerEvents$.next(
      new NavigationEnd(
        1,
        '/dashboard/principal?from=login',
        '/dashboard/principal?from=login#section'
      )
    );

    expect(emitted.at(-1)).toEqual({
      routerReady: true,
      currentUrl: '/dashboard/principal?from=login#section',
      navPath: '/dashboard/principal',
      inRegistrationFlow: false,
    });
    expect(report).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });

  it('diagnostica silenciosamente e devolve o fallback seguro do stream', async () => {
    const service = TestBed.inject(AuthRouteContextService);
    const original = new Error('router stream failed');
    const fallback = {
      routerReady: false,
      currentUrl: '/dashboard/principal',
      navPath: null,
      inRegistrationFlow: true,
    };

    const value = await firstValueFrom(
      (service as any).handleStreamError('context$', fallback)(original)
    );

    expect(value).toEqual(fallback);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(original, {
      feature: 'auth-route-context',
      operation: 'context$',
      fallbackMessage:
        'Não foi possível atualizar o contexto interno de navegação.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'AuthRouteContextService',
        context: 'context$',
      },
    });
  });

  it('preserva o fallback se a própria camada canônica de diagnóstico falhar', async () => {
    const service = TestBed.inject(AuthRouteContextService);
    const fallback = {
      routerReady: false,
      currentUrl: '/',
      navPath: null,
      inRegistrationFlow: true,
    };

    report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    await expect(
      firstValueFrom(
        (service as any).handleStreamError('context$', fallback)(
          new Error('stream failed')
        )
      )
    ).resolves.toEqual(fallback);

    expect(report).toHaveBeenCalledTimes(1);
  });
});
