import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationCancellationCode,
  Router,
} from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { RouterDiagnosticsService } from './router-diagnostics.service';

type MockFn = ReturnType<typeof vi.fn>;

describe('RouterDiagnosticsService', () => {
  let events$: Subject<unknown>;
  let service: RouterDiagnosticsService;
  let applicationErrorMock: { report: MockFn };
  let notificationMock: { showError: MockFn };

  beforeEach(() => {
    events$ = new Subject<unknown>();
    applicationErrorMock = {
      report: vi.fn(),
    };
    notificationMock = {
      showError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        RouterDiagnosticsService,
        {
          provide: Router,
          useValue: {
            events: events$.asObservable(),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: applicationErrorMock,
        },
        {
          provide: ErrorNotificationService,
          useValue: notificationMock,
        },
      ],
    });

    service = TestBed.inject(RouterDiagnosticsService);
    service.start();
  });

  afterEach(() => {
    events$.complete();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('ignora cancelamento quando uma navegação mais nova substitui a anterior', () => {
    events$.next(
      new NavigationCancel(
        3,
        '/preferencias/editar/user-id',
        'Navigation ID 3 is not equal to the current navigation id 4',
        NavigationCancellationCode.SupersededByNewNavigation
      )
    );

    expect(applicationErrorMock.report).not.toHaveBeenCalled();
    expect(notificationMock.showError).not.toHaveBeenCalled();
  });

  it('mantém diagnóstico silencioso para cancelamento que não é superseded', () => {
    events$.next(
      new NavigationCancel(
        4,
        '/dashboard/principal',
        'Resolver completed without emitting a value',
        NavigationCancellationCode.NoDataFromResolver
      )
    );

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        feature: 'router',
        operation: 'NavigationCancel',
        presentation: { surface: 'none', severity: 'error' },
      })
    );
    expect(notificationMock.showError).not.toHaveBeenCalled();
  });
});
