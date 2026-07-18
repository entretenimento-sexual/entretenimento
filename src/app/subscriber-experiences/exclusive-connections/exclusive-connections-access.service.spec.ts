import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessDecision } from 'src/app/core/access/content-access-policy.model';
import { ContentAccessPolicyService } from 'src/app/core/access/content-access-policy.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { BillingRepository } from 'src/app/payments-core/infrastructure/repositories/billing.repository';
import {
  evaluateExclusiveConnectionsBillingSnapshot,
  ExclusiveConnectionsAccessService,
} from './exclusive-connections-access.service';

function createProfileDecision(
  overrides: Partial<ContentAccessDecision> = {}
): ContentAccessDecision {
  return {
    allowed: true,
    reason: null,
    recommendedAction: null,
    minimumRole: null,
    missingProfileFields: [],
    ...overrides,
  };
}

describe('evaluateExclusiveConnectionsBillingSnapshot', () => {
  it('permite Premium e VIP com entitlement ativo da plataforma', () => {
    expect(
      evaluateExclusiveConnectionsBillingSnapshot({
        role: 'premium',
        tier: 'premium',
        isSubscriber: true,
        entitlements: ['platform_subscription'],
      }).allowed
    ).toBe(true);

    expect(
      evaluateExclusiveConnectionsBillingSnapshot({
        role: 'vip',
        tier: 'vip',
        isSubscriber: true,
        entitlements: ['platform_subscription'],
      }).allowed
    ).toBe(true);
  });

  it('nega plano inferior mesmo com assinatura ativa', () => {
    expect(
      evaluateExclusiveConnectionsBillingSnapshot({
        role: 'basic',
        tier: 'basic',
        isSubscriber: true,
        entitlements: ['platform_subscription'],
      })
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: 'role_insufficient',
        minimumRole: 'premium',
      })
    );
  });

  it('nega snapshot sem entitlement autoritativo', () => {
    expect(
      evaluateExclusiveConnectionsBillingSnapshot({
        role: 'premium',
        tier: 'premium',
        isSubscriber: true,
        entitlements: [],
      })
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: 'subscription_inactive',
      })
    );
  });
});

describe('ExclusiveConnectionsAccessService', () => {
  const contentAccessMock = {
    evaluate$: vi.fn(),
  };
  const billingRepositoryMock = {
    getMyBillingSnapshot$: vi.fn(),
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
        ExclusiveConnectionsAccessService,
        { provide: ContentAccessPolicyService, useValue: contentAccessMock },
        { provide: BillingRepository, useValue: billingRepositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  it('não consulta billing quando conta, consentimento ou perfil já negam acesso', async () => {
    contentAccessMock.evaluate$.mockReturnValue(
      of(
        createProfileDecision({
          allowed: false,
          reason: 'profile_incomplete',
          recommendedAction: 'complete_profile',
        })
      )
    );

    const service = TestBed.inject(ExclusiveConnectionsAccessService);
    const decision = await firstValueFrom(service.evaluate$());

    expect(decision).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: 'profile_incomplete',
        minimumRole: 'premium',
      })
    );
    expect(billingRepositoryMock.getMyBillingSnapshot$).not.toHaveBeenCalled();
  });

  it('permite somente após perfil aprovado e snapshot Premium autoritativo', async () => {
    contentAccessMock.evaluate$.mockReturnValue(of(createProfileDecision()));
    billingRepositoryMock.getMyBillingSnapshot$.mockReturnValue(
      of({
        role: 'premium',
        tier: 'premium',
        isSubscriber: true,
        entitlements: ['platform_subscription'],
      })
    );

    const service = TestBed.inject(ExclusiveConnectionsAccessService);
    const decision = await firstValueFrom(service.evaluate$());

    expect(decision).toEqual(
      expect.objectContaining({
        allowed: true,
        minimumRole: 'premium',
      })
    );
    expect(billingRepositoryMock.getMyBillingSnapshot$).toHaveBeenCalledTimes(1);
  });

  it('falha fechada e centraliza o erro quando o snapshot não pode ser consultado', async () => {
    contentAccessMock.evaluate$.mockReturnValue(of(createProfileDecision()));
    billingRepositoryMock.getMyBillingSnapshot$.mockReturnValue(
      throwError(() => new Error('functions/unavailable'))
    );

    const service = TestBed.inject(ExclusiveConnectionsAccessService);
    const decision = await firstValueFrom(service.evaluate$());

    expect(decision).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: 'access_check_unavailable',
        recommendedAction: null,
        minimumRole: 'premium',
      })
    );
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível verificar sua assinatura agora.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });
});
