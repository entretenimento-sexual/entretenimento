import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  BehaviorSubject,
  firstValueFrom,
  of,
  throwError,
} from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { COMMUNITY_CREATE_RETURN_URL } from 'src/app/subscriptions/domain/subscription-flow-context.model';
import { BillingPlan } from '../domain/models/billing-plan.model';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import { CheckoutFacade } from './checkout.facade';

describe('CheckoutFacade', () => {
  const plan: BillingPlan = {
    id: 'plan-basic-v1',
    key: 'basic',
    scope: 'platform_subscription',
    title: 'Plano Básico',
    description: 'Plano inicial.',
    amountCents: 1_999,
    currency: 'BRL',
    interval: 'month',
    active: true,
  };
  const getPlatformPlanByKey$ = vi.fn();
  const createPlatformCheckoutSession$ = vi.fn();
  const navigate = vi.fn();
  const report = vi.fn();
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let facade: CheckoutFacade;

  beforeEach(() => {
    vi.clearAllMocks();
    queryParamMap$ = new BehaviorSubject(convertToParamMap({
      plan: 'basic',
      minimumRole: 'basic',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    }));
    getPlatformPlanByKey$.mockReturnValue(of(plan));
    createPlatformCheckoutSession$.mockReturnValue(of({
      provider: 'emulator',
      providerSessionId: 'provider-1',
      checkoutUrl: 'http://127.0.0.1:4200/billing/return',
    }));
    navigate.mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        CheckoutFacade,
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParamMap$.asObservable() },
        },
        { provide: Router, useValue: { navigate } },
        {
          provide: BillingRepository,
          useValue: {
            getPlatformPlanByKey$,
            createPlatformCheckoutSession$,
          },
        },
        { provide: ApplicationErrorService, useValue: { report } },
      ],
    });

    facade = TestBed.inject(CheckoutFacade);
  });

  it('envia ao backend somente o contexto de continuação normalizado', async () => {
    const result = await firstValueFrom(facade.startCheckout$());

    expect(result).toEqual({
      status: 'ready',
      checkoutUrl: 'http://127.0.0.1:4200/billing/return',
    });
    expect(createPlatformCheckoutSession$).toHaveBeenCalledWith(plan, {
      minimumRole: 'basic',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    });
  });

  it('explica quando a renovação recorrente do mesmo plano já está ativa', async () => {
    createPlatformCheckoutSession$.mockReturnValue(
      throwError(() => ({
        details: { reason: 'recurring_renewal_already_enabled' },
      }))
    );

    expect(await firstValueFrom(facade.startCheckout$())).toEqual({
      status: 'error',
    });
    expect(report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fallbackMessage:
          'A renovação automática deste plano já está ativa. Você pode gerenciá-la na sua conta.',
      })
    );
  });

  it('explica quando o cancelamento recorrente ainda está convergindo', async () => {
    createPlatformCheckoutSession$.mockReturnValue(
      throwError(() => ({
        details: { reason: 'recurring_cancellation_pending' },
      }))
    );

    expect(await firstValueFrom(facade.startCheckout$())).toEqual({
      status: 'error',
    });
    expect(report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fallbackMessage:
          'O cancelamento da renovação anterior ainda está sendo confirmado. Aguarde essa conclusão antes de contratar outro plano.',
      })
    );
  });

  it('preserva o contexto ao voltar para os planos', async () => {
    await firstValueFrom(facade.goBackToPlans());

    expect(navigate).toHaveBeenCalledWith(['/subscription-plan'], {
      queryParams: {
        minimumRole: 'basic',
        returnUrl: COMMUNITY_CREATE_RETURN_URL,
      },
    });
  });

  it('descarta um retorno externo antes de criar o checkout', async () => {
    queryParamMap$.next(convertToParamMap({
      plan: 'basic',
      minimumRole: 'basic',
      returnUrl: 'https://example.com/capture',
    }));

    await firstValueFrom(facade.startCheckout$());

    expect(createPlatformCheckoutSession$).toHaveBeenLastCalledWith(plan, {
      minimumRole: 'basic',
      returnUrl: null,
    });
  });
});
