import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from '../services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../services/error-handler/global-error-handler.service';
import { ContentAccessDecision } from './content-access-policy.model';
import {
  ContentAccessNavigationService,
  resolveContentAccessNavigationTarget,
} from './content-access-navigation.service';

function createDecision(
  overrides: Partial<ContentAccessDecision> = {}
): ContentAccessDecision {
  return {
    allowed: false,
    reason: 'subscription_inactive',
    recommendedAction: 'upgrade_subscription',
    minimumRole: 'premium',
    missingProfileFields: [],
    ...overrides,
  };
}

describe('resolveContentAccessNavigationTarget', () => {
  it('não cria destino para uma decisão permitida', () => {
    expect(
      resolveContentAccessNavigationTarget(
        createDecision({
          allowed: true,
          reason: null,
          recommendedAction: null,
        }),
        '/descobrir'
      )
    ).toBeNull();
  });

  it('preserva a rota atual ao encaminhar para login', () => {
    expect(
      resolveContentAccessNavigationTarget(
        createDecision({
          reason: 'unauthenticated',
          recommendedAction: 'sign_in',
          minimumRole: null,
        }),
        '/descobrir?modo=hoje'
      )
    ).toEqual({
      commands: ['/login'],
      queryParams: { returnUrl: '/descobrir?modo=hoje' },
    });
  });

  it('evita returnUrl circular quando o usuário já está no destino', () => {
    expect(
      resolveContentAccessNavigationTarget(
        createDecision({
          reason: 'unauthenticated',
          recommendedAction: 'sign_in',
          minimumRole: null,
        }),
        '/login'
      )
    ).toEqual({ commands: ['/login'] });
  });

  it('informa o nível mínimo ao encaminhar para planos', () => {
    expect(
      resolveContentAccessNavigationTarget(
        createDecision({ minimumRole: 'vip' }),
        '/media/exclusiva'
      )
    ).toEqual({
      commands: ['/subscription-plan'],
      queryParams: {
        returnUrl: '/media/exclusiva',
        minimumRole: 'vip',
      },
    });
  });

  it('ignora returnUrl externo ou inválido', () => {
    expect(
      resolveContentAccessNavigationTarget(
        createDecision({
          reason: 'profile_incomplete',
          recommendedAction: 'complete_profile',
          minimumRole: null,
        }),
        'https://example.com'
      )
    ).toEqual({ commands: ['/register/finalizar-cadastro'] });
  });
});

describe('ContentAccessNavigationService', () => {
  const routerMock = {
    url: '/descobrir',
    navigate: vi.fn(),
  };
  const errorNotifierMock = {
    showError: vi.fn(),
  };
  const globalErrorMock = {
    handleError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        ContentAccessNavigationService,
        { provide: Router, useValue: routerMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  it('navega pela rota canônica com contexto de retorno', async () => {
    routerMock.navigate.mockResolvedValue(true);
    const service = TestBed.inject(ContentAccessNavigationService);

    await expect(
      service.navigateForDecision(createDecision())
    ).resolves.toBe(true);

    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/subscription-plan'],
      {
        queryParams: {
          returnUrl: '/descobrir',
          minimumRole: 'premium',
        },
      }
    );
  });

  it('centraliza feedback e diagnóstico quando a navegação falha', async () => {
    routerMock.navigate.mockRejectedValue(new Error('route failed'));
    const service = TestBed.inject(ContentAccessNavigationService);

    await expect(
      service.navigateForDecision(createDecision())
    ).resolves.toBe(false);

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível abrir esta etapa.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });
});
