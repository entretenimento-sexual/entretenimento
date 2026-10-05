import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';

import { MediaApplicationErrorService } from './media-application-error.service';
import {
  MEDIA_ERROR_CODE_MESSAGES,
  MEDIA_ERROR_CODE_PRESENTATIONS,
  MEDIA_ERROR_MESSAGES,
  MEDIA_ERROR_PRESENTATIONS,
} from './media-error.catalog';

describe('MediaApplicationErrorService', () => {
  function configure() {
    const descriptor = {
      code: null,
      reason: null,
      recommendedAction: null,
      userMessage: 'teste',
      retryable: false,
      presentation: {
        surface: 'snackbar' as const,
        severity: 'error' as const,
      },
    };
    const applicationErrorMock = {
      report: vi.fn(() => descriptor),
    };

    TestBed.configureTestingModule({
      providers: [
        MediaApplicationErrorService,
        {
          provide: ApplicationErrorService,
          useValue: applicationErrorMock,
        },
      ],
    });

    return {
      service: TestBed.inject(MediaApplicationErrorService),
      applicationErrorMock,
      descriptor,
    };
  }

  it('entrega os catálogos canônicos de Media à fronteira global', () => {
    const { service, applicationErrorMock } = configure();

    service.report(
      { code: 'functions/unavailable' },
      {
        operation: 'photo.load',
        reasonHint: 'media_discovery_load_failed',
      }
    );

    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        feature: 'media',
        codeMessages: MEDIA_ERROR_CODE_MESSAGES,
        codePresentations: MEDIA_ERROR_CODE_PRESENTATIONS,
        reasonMessages: MEDIA_ERROR_MESSAGES,
        reasonPresentations: MEDIA_ERROR_PRESENTATIONS,
      })
    );
  });

  it('preserva presentation de código de transporte conhecido acima do reasonHint', () => {
    const { service, applicationErrorMock } = configure();

    service.report(
      { code: 'functions/unauthenticated' },
      {
        operation: 'photo.upload',
        reasonHint: 'photo_upload_failed',
      }
    );

    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        presentation: undefined,
        fallbackMessage: MEDIA_ERROR_MESSAGES.photo_upload_failed,
      })
    );
  });

  it('usa presentation do reason canônico real acima do código de transporte', () => {
    const { service, applicationErrorMock } = configure();

    service.report(
      {
        code: 'functions/unavailable',
        details: { reason: 'ACCOUNT_UNAVAILABLE' },
      },
      {
        operation: 'photo.load',
        reasonHint: 'media_discovery_load_failed',
      }
    );

    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        presentation: undefined,
        fallbackMessage: MEDIA_ERROR_MESSAGES.ACCOUNT_UNAVAILABLE,
      })
    );
  });

  it('usa presentation do reasonHint quando não há reason nem code conhecidos', () => {
    const { service, applicationErrorMock } = configure();

    service.report(
      new Error('falha local'),
      {
        operation: 'photoEditor.launch',
        reasonHint: 'photo_editor_failed',
      }
    );

    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        presentation: MEDIA_ERROR_PRESENTATIONS.photo_editor_failed,
        fallbackMessage: MEDIA_ERROR_MESSAGES.photo_editor_failed,
      })
    );
  });

  it('mantém reportSilently sem feedback global mesmo com reason conhecido', () => {
    const { service, applicationErrorMock } = configure();

    service.reportSilently(
      { reason: 'photo_delete_failed' },
      'photoStorage.deleteOwnedPrivatePhoto',
      undefined,
      { scope: 'PhotoStorageLifecycleService' },
      'photo_delete_failed'
    );

    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        presentation: { surface: 'none', severity: 'error' },
      })
    );
  });
});
