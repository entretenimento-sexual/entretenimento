// src/app/core/services/error-handler/application-error.service.spec.ts
// -----------------------------------------------------------------------------
// APPLICATION ERROR SERVICE - CONTRACT TESTS
// -----------------------------------------------------------------------------

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from './error-notification.service';
import { GlobalErrorHandlerService } from './global-error-handler.service';
import { ApplicationErrorService } from './application-error.service';

describe('ApplicationErrorService', () => {
  const notifier = {
    showError: vi.fn(),
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  };
  const globalError = {
    handleError: vi.fn(),
  };

  let service: ApplicationErrorService;

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        ApplicationErrorService,
        { provide: ErrorNotificationService, useValue: notifier },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    service = TestBed.inject(ApplicationErrorService);
  });

  it('normaliza código de Functions e prioriza reason de domínio conhecido', () => {
    const descriptor = service.report(
      {
        code: 'functions/resource-exhausted',
        message: 'backend internal detail that must not reach the UI',
        details: {
          reason: 'community_feed_rate_limited',
          recommendedAction: 'wait',
        },
      },
      {
        feature: 'community',
        operation: 'createPost',
        fallbackMessage: 'Não foi possível enviar a mensagem agora.',
        reasonMessages: {
          community_feed_rate_limited:
            'Você atingiu o limite temporário de mensagens. Tente mais tarde.',
        },
      }
    );

    expect(descriptor).toEqual({
      code: 'resource-exhausted',
      reason: 'community_feed_rate_limited',
      recommendedAction: 'wait',
      userMessage:
        'Você atingiu o limite temporário de mensagens. Tente mais tarde.',
      retryable: true,
    });
    expect(notifier.showError).toHaveBeenCalledWith(
      'Você atingiu o limite temporário de mensagens. Tente mais tarde.'
    );
    expect(notifier.showError.mock.calls[0]?.[0]).not.toContain('backend internal');
  });

  it('usa mensagem canônica para indisponibilidade transitória', () => {
    const descriptor = service.normalize(
      { code: 'functions/unavailable' },
      {
        feature: 'community',
        operation: 'loadPage',
        fallbackMessage: 'Não foi possível carregar o Mural.',
      }
    );

    expect(descriptor.userMessage).toBe(
      'O serviço está temporariamente indisponível. Tente novamente em instantes.'
    );
    expect(descriptor.retryable).toBe(true);
  });

  it('mantém fallback contextual para erro sem código reconhecido', () => {
    const descriptor = service.normalize(
      new Error('detalhe técnico'),
      {
        feature: 'community',
        operation: 'loadPage',
        fallbackMessage: 'Não foi possível carregar o mural da Comunidade agora.',
      }
    );

    expect(descriptor.userMessage).toBe(
      'Não foi possível carregar o mural da Comunidade agora.'
    );
    expect(descriptor.code).toBeNull();
    expect(descriptor.retryable).toBe(false);
  });

  it('permite feedback warning sem duplicar notificação pelo global handler', () => {
    service.report(
      { code: 'functions/not-found' },
      {
        feature: 'community',
        operation: 'navigateReference',
        fallbackMessage: 'A publicação original não está disponível.',
        notification: 'warning',
        codeMessages: {
          'not-found': 'A publicação original não está disponível neste momento.',
        },
        metadata: { view: 'feed' },
      }
    );

    expect(notifier.showWarning).toHaveBeenCalledWith(
      'A publicação original não está disponível neste momento.'
    );
    expect(notifier.showError).not.toHaveBeenCalled();
    expect(globalError.handleError).toHaveBeenCalledTimes(1);

    const diagnostic = globalError.handleError.mock.calls[0]?.[0] as Error & {
      context?: Record<string, unknown>;
      skipUserNotification?: boolean;
    };
    expect(diagnostic.skipUserNotification).toBe(true);
    expect(diagnostic.context).toMatchObject({
      feature: 'community',
      operation: 'navigateReference',
      view: 'feed',
    });
  });

  it('aceita diagnóstico silencioso para streams realtime', () => {
    service.report(
      { code: 'functions/unavailable' },
      {
        feature: 'community',
        operation: 'watchRealtime',
        fallbackMessage: 'Atualizações em tempo real indisponíveis.',
        notification: 'none',
      }
    );

    expect(notifier.showError).not.toHaveBeenCalled();
    expect(notifier.showWarning).not.toHaveBeenCalled();
    expect(notifier.showInfo).not.toHaveBeenCalled();
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });
});
