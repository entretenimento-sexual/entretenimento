// src/test/angular-error-testing.providers.ts
import { Provider } from '@angular/core';
import { vi } from 'vitest';

import { GlobalErrorHandlerService } from '../app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../app/core/services/error-handler/error-notification.service';

export type VitestMockFn = ReturnType<typeof vi.fn>;

export interface GlobalErrorHandlerTestingMock {
  handleError: VitestMockFn;
}

export interface ErrorNotificationTestingMock {
  showError: VitestMockFn;
  showSuccess: VitestMockFn;
  showWarning: VitestMockFn;
  showInfo: VitestMockFn;
}

export interface ErrorTestingProviderMocks {
  globalErrorHandler: GlobalErrorHandlerTestingMock;
  errorNotification: ErrorNotificationTestingMock;
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
    globalErrorHandler: createGlobalErrorHandlerTestingMock(),
    errorNotification: createErrorNotificationTestingMock(),
  };
}

export function provideErrorTestingMocks(mocks: ErrorTestingProviderMocks): Provider[] {
  return [
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
