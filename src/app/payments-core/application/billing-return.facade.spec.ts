import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { COMMUNITY_CREATE_RETURN_URL } from 'src/app/subscriptions/domain/subscription-flow-context.model';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import { BillingReturnFacade } from './billing-return.facade';

describe('BillingReturnFacade', () => {
  const processBillingReturn$ = vi.fn();
  const getMyBillingSnapshot$ = vi.fn();
  const navigate = vi.fn();
  const navigateByUrl = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let facade: BillingReturnFacade;

  beforeEach(() => {
    vi.clearAllMocks();
    queryParamMap$ = new BehaviorSubject(convertToParamMap({
      billing: 'success',
      scope: 'platform_subscription',
      checkoutSessionId: 'checkout-1',
      minimumRole: 'basic',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    }));
    processBillingReturn$.mockReturnValue(of({
      status: 'granted',
      scope: 'platform_subscription',
      role: 'basic',
      accessGranted: true,
      checkoutSessionId: 'checkout-1',
      redirectTo: COMMUNITY_CREATE_RETURN_URL,
    }));
    getMyBillingSnapshot$.mockReturnValue(of(null));
    navigate.mockResolvedValue(true);
    navigateByUrl.mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        BillingReturnFacade,
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParamMap$.asObservable() },
        },
        { provide: Router, useValue: { navigate, navigateByUrl } },
        {
          provide: AuthSessionService,
          useValue: {
            whenReady: vi.fn().mockResolvedValue(undefined),
            uid$: of('user-1'),
          },
        },
        {
          provide: BillingRepository,
          useValue: { processBillingReturn$, getMyBillingSnapshot$ },
        },
        { provide: ErrorNotificationService, useValue: { showError } },
        { provide: GlobalErrorHandlerService, useValue: { handleError } },
      ],
    });

    facade = TestBed.inject(BillingReturnFacade);
  });

  it('retorna ao compositor após o backend confirmar o acesso', async () => {
    const vm = await firstValueFrom(facade.vm$);

    expect(vm.status).toBe('granted');
    expect(navigateByUrl).toHaveBeenCalledWith(
      COMMUNITY_CREATE_RETURN_URL,
      { replaceUrl: true }
    );
  });

  it('não aceita redirecionamento externo mesmo em resposta inesperada', async () => {
    processBillingReturn$.mockReturnValue(of({
      status: 'granted',
      scope: 'platform_subscription',
      role: 'basic',
      accessGranted: true,
      redirectTo: 'https://example.com/capture',
    }));

    await firstValueFrom(facade.vm$);

    expect(navigateByUrl).toHaveBeenCalledWith(
      COMMUNITY_CREATE_RETURN_URL,
      { replaceUrl: true }
    );
  });

  it('preserva o contexto ao voltar aos planos após cancelamento', async () => {
    queryParamMap$.next(convertToParamMap({
      billing: 'cancel',
      scope: 'platform_subscription',
      checkoutSessionId: 'checkout-1',
      minimumRole: 'basic',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    }));

    await firstValueFrom(facade.retry());

    expect(navigate).toHaveBeenCalledWith(['/subscription-plan'], {
      queryParams: {
        minimumRole: 'basic',
        returnUrl: COMMUNITY_CREATE_RETURN_URL,
      },
    });
  });
});
