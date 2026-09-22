import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { PlatformSubscriptionAccessService } from '@core/services/subscriptions/platform-subscription-access.service';
import { BillingRepository } from 'src/app/payments-core/infrastructure/repositories/billing.repository';

import { SubscriptionHistoryComponent } from './subscription-history.component';

describe('SubscriptionHistoryComponent', () => {
  const repositoryMock = {
    getMyPlatformSubscriptionHistory$: vi.fn(),
  };

  const applicationErrorMock = {
    report: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getMyPlatformSubscriptionHistory$.mockReset();

    TestBed.configureTestingModule({
      imports: [SubscriptionHistoryComponent],
      providers: [
        {
          provide: BillingRepository,
          useValue: repositoryMock,
        },
        {
          provide: PlatformSubscriptionAccessService,
          useValue: {
            state$: of({
              active: false,
              role: 'free',
              startsAt: null,
              endsAt: null,
              projectionVersion: 1,
            }),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: applicationErrorMock,
        },
      ],
    });

    TestBed.overrideComponent(SubscriptionHistoryComponent, {
      set: { template: '' },
    });
  });

  it('mantém a falha do carregamento inicial silenciosa e centralizada', () => {
    const error = new Error('initial failure');
    repositoryMock.getMyPlatformSubscriptionHistory$.mockReturnValue(
      throwError(() => error)
    );

    const fixture = TestBed.createComponent(SubscriptionHistoryComponent);

    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'subscription-history',
      operation: 'loadHistory',
      fallbackMessage: 'Não foi possível carregar o histórico da assinatura.',
      notification: 'none',
      metadata: {
        scope: 'SubscriptionHistoryComponent',
      },
    });

    fixture.destroy();
  });

  it('usa a apresentação canônica de erro ao falhar em carregar mais', () => {
    const error = new Error('load more failure');
    repositoryMock.getMyPlatformSubscriptionHistory$
      .mockReturnValueOnce(of({ items: [], nextCursor: 'next' }))
      .mockReturnValueOnce(throwError(() => error));

    const fixture = TestBed.createComponent(SubscriptionHistoryComponent);
    fixture.componentInstance.loadMore();

    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'subscription-history',
      operation: 'loadMoreHistory',
      fallbackMessage: 'Não foi possível carregar registros mais antigos.',
      notification: 'error',
      metadata: {
        scope: 'SubscriptionHistoryComponent',
      },
    });

    fixture.destroy();
  });
});
