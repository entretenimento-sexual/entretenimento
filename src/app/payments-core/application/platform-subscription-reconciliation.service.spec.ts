import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import { PlatformSubscriptionReconciliationService } from './platform-subscription-reconciliation.service';

const NOW = 1_800_000_000_000;

const CURRENT_USER: IUserDados = {
  uid: 'u1',
  email: 'u1@example.com',
  photoURL: null,
  role: 'free',
  tier: 'free',
  lastLogin: NOW,
  descricao: '',
  isSubscriber: false,
  monthlyPayer: false,
  subscriptionStatus: 'inactive',
};

describe('PlatformSubscriptionReconciliationService', () => {
  let ready$: BehaviorSubject<boolean>;
  let uid$: BehaviorSubject<string | null>;
  let current: IUserDados;
  let getSnapshotMock: ReturnType<typeof vi.fn>;
  let patchMock: ReturnType<typeof vi.fn>;
  let service: PlatformSubscriptionReconciliationService;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    ready$ = new BehaviorSubject<boolean>(true);
    uid$ = new BehaviorSubject<string | null>('u1');
    current = { ...CURRENT_USER };
    getSnapshotMock = vi.fn(() =>
      of({
        role: 'premium',
        tier: 'premium',
        isSubscriber: true,
        status: 'active',
        entitlements: ['platform_subscription'],
        startsAt: NOW - 60_000,
        endsAt: NOW + 60_000,
        updatedAt: NOW,
        projectionVersion: 1,
      })
    );
    patchMock = vi.fn((partial: Partial<IUserDados>) => {
      current = { ...current, ...partial };
    });

    TestBed.configureTestingModule({
      providers: [
        PlatformSubscriptionReconciliationService,
        {
          provide: AuthSessionService,
          useValue: {
            ready$: ready$.asObservable(),
            uid$: uid$.asObservable(),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            getSnapshot: () => current,
            patch: patchMock,
          },
        },
        {
          provide: BillingRepository,
          useValue: { getMyBillingSnapshot$: getSnapshotMock },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(PlatformSubscriptionReconciliationService);
  });

  it('aplica snapshot canônico ativo ao runtime', () => {
    service.start();

    expect(getSnapshotMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'premium',
        tier: 'premium',
        billingProjectionVersion: 1,
        isSubscriber: true,
        monthlyPayer: true,
        subscriptionStatus: 'active',
        subscriptionScope: 'platform_subscription',
        subscriptionEndsAt: NOW + 60_000,
      })
    );
  });

  it('faz fail-closed quando o período retornado já expirou', () => {
    getSnapshotMock.mockReturnValueOnce(
      of({
        role: 'premium',
        tier: 'premium',
        isSubscriber: true,
        status: 'active',
        entitlements: ['platform_subscription'],
        startsAt: NOW - 60_000,
        endsAt: NOW,
        updatedAt: NOW,
        projectionVersion: 1,
      })
    );

    service.start();

    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'free',
        tier: 'free',
        isSubscriber: false,
        monthlyPayer: false,
        subscriptionStatus: 'inactive',
        subscriptionScope: null,
      })
    );
  });

  it('reconcilia novamente após logout e login do mesmo usuário', () => {
    service.start();
    uid$.next(null);
    uid$.next('u1');

    expect(getSnapshotMock).toHaveBeenCalledTimes(2);
  });
});
