// src/app/core/services/error-handler/application-error.service.spec.ts
// -----------------------------------------------------------------------------
// APPLICATION ERROR SERVICE - CONTRACT TESTS
// -----------------------------------------------------------------------------

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from './application-error.service';
import { ErrorNotificationService } from './error-notification.service';
import { GlobalErrorHandlerService } from './global-error-handler.service';

describe('ApplicationErrorService', () => {
  const notifier = {
    showApplicationError: vi.fn(),
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
      presentation: {
        surface: 'snackbar',
        severity: 'error',
      },
    });
    expect(notifier.showApplicationError).toHaveBeenCalledWith(
      'Você atingiu o limite temporário de mensagens. Tente mais tarde.',
      {
        surface: 'snackbar',
        severity: 'error',
      }
    );
    expect(notifier.showApplicationError.mock.calls[0]?.[0]).not.toContain(
      'backend internal'
    );
  });

  it('prioriza recommendedAction conhecida quando não há reason mapeado', () => {
    const descriptor = service.normalize(
      {
        code: 'functions/permission-denied',
        details: {
          recommendedAction: 'upgrade_subscription',
        },
      },
      {
        feature: 'community',
        operation: 'createPost',
        fallbackMessage: 'Não foi possível publicar agora.',
        codeMessages: {
          'permission-denied':
            'Sua conta não pode publicar neste espaço agora.',
        },
        recommendedActionMessages: {
          upgrade_subscription:
            'Seu plano atual não permite publicar neste espaço.',
        },
      }
    );

    expect(descriptor.userMessage).toBe(
      'Seu plano atual não permite publicar neste espaço.'
    );
    expect(descriptor.recommendedAction).toBe('upgrade_subscription');
  });

  it('resolve apresentação por reason antes de fallback legado', () => {
    const descriptor = service.normalize(
      {
        code: 'functions/failed-precondition',
        details: { reason: 'recent-authentication-required' },
      },
      {
        feature: 'community',
        operation: 'updateSettings',
        fallbackMessage: 'Não foi possível salvar.',
        notification: 'warning',
        reasonPresentations: {
          'recent-authentication-required': {
            surface: 'modal',
            severity: 'warning',
            title: 'Confirme sua identidade',
          },
        },
      }
    );

    expect(descriptor.presentation).toEqual({
      surface: 'modal',
      severity: 'warning',
      title: 'Confirme sua identidade',
    });
  });

  it('remove rota externa de uma apresentação acionável', () => {
    const descriptor = service.normalize(
      { code: 'functions/permission-denied' },
      {
        feature: 'community',
        operation: 'updateSettings',
        fallbackMessage: 'Não foi possível salvar.',
        presentation: {
          surface: 'modal',
          severity: 'info',
          primaryAction: {
            label: 'Continuar',
            route: 'https://example.com/fora',
          },
        },
      }
    );

    expect(descriptor.presentation.primaryAction).toEqual({
      label: 'Continuar',
    });
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

  it('preserva feedback warning legado sem duplicar pelo global handler', () => {
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

    expect(notifier.showApplicationError).toHaveBeenCalledWith(
      'A publicação original não está disponível neste momento.',
      {
        surface: 'snackbar',
        severity: 'warning',
      }
    );
    expect(globalError.handleError).toHaveBeenCalledTimes(1);

    const diagnostic = globalError.handleError.mock.calls[0]?.[0] as Error & {
      context?: Record<string, unknown>;
      skipUserNotification?: boolean;
      userFacingSurface?: string;
    };
    expect(diagnostic.skipUserNotification).toBe(true);
    expect(diagnostic.userFacingSurface).toBe('snackbar');
    expect(diagnostic.context).toMatchObject({
      feature: 'community',
      operation: 'navigateReference',
      view: 'feed',
    });
  });

  it('preserva diagnóstico silencioso para streams realtime', () => {
    const descriptor = service.report(
      { code: 'functions/unavailable' },
      {
        feature: 'community',
        operation: 'watchRealtime',
        fallbackMessage: 'Atualizações em tempo real indisponíveis.',
        notification: 'none',
      }
    );

    expect(descriptor.presentation).toEqual({
      surface: 'none',
      severity: 'error',
    });
    expect(notifier.showApplicationError).toHaveBeenCalledWith(
      'O serviço está temporariamente indisponível. Tente novamente em instantes.',
      {
        surface: 'none',
        severity: 'error',
      }
    );
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });
});
