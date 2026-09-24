// src/test/angular-error-testing.providers.ts
import { Provider } from '@angular/core';
import { vi } from 'vitest';

import { ApplicationErrorService } from '../app/core/services/error-handler/application-error.service';
import { GlobalErrorHandlerService } from '../app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../app/core/services/error-handler/error-notification.service';

export type VitestMockFn = ReturnType<typeof vi.fn>;

export interface GlobalErrorHandlerTestingMock {
  handleError: VitestMockFn;
}

export interface ApplicationErrorTestingMock {
  normalize: VitestMockFn;
  report: VitestMockFn;
}

export interface ErrorNotificationTestingMock {
  showError: VitestMockFn;
  showSuccess: VitestMockFn;
  showWarning: VitestMockFn;
  showInfo: VitestMockFn;
}

export interface ErrorTestingProviderMocks {
  applicationError: ApplicationErrorTestingMock;
  globalErrorHandler: GlobalErrorHandlerTestingMock;
  errorNotification: ErrorNotificationTestingMock;
}

export function createApplicationErrorTestingMock(): ApplicationErrorTestingMock {
  const descriptor = (
    options?: { fallbackMessage?: string }
  ) => ({
    code: null,
    reason: null,
    recommendedAction: null,
    userMessage:
      options?.fallbackMessage ?? 'Não foi possível concluir a ação agora.',
    retryable: false,
    presentation: {
      surface: 'snackbar',
      severity: 'error',
    },
  });

  return {
    normalize: vi.fn((_error: unknown, options?: { fallbackMessage?: string }) =>
      descriptor(options)
    ),
    report: vi.fn((_error: unknown, options?: { fallbackMessage?: string }) =>
      descriptor(options)
    ),
  };
}

export function createGlobalErrorHandlerTestingMock(): GlobalErrorHandlerTestingMock {
  return {
    handleError: vi.fn(),
  };
}

export function createErrorNotificationTestingMock(): ErrorNotificationTestingMock {
  return {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  };
}

export function createErrorTestingProviderMocks(): ErrorTestingProviderMocks {
  return {
    applicationError: createApplicationErrorTestingMock(),
    globalErrorHandler: createGlobalErrorHandlerTestingMock(),
    errorNotification: createErrorNotificationTestingMock(),
  };
}

export function provideErrorTestingMocks(mocks: ErrorTestingProviderMocks): Provider[] {
  return [
    {
      provide: ApplicationErrorService,
      useValue: mocks.applicationError,
    },
    {
      provide: GlobalErrorHandlerService,
      useValue: mocks.globalErrorHandler,
    },
    {
      provide: ErrorNotificationService,
      useValue: mocks.errorNotification,
    },
  ];
}
