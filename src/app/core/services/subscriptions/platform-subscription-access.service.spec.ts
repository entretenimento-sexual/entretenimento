import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '../../interfaces/iuser-dados';
import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';
import { PlatformSubscriptionAccessService } from './platform-subscription-access.service';
import type { PlatformSubscriptionRole } from './platform-subscription-access.model';

const NOW = 1_800_000_000_000;

function createUser(
  endsAt: number,
  role: PlatformSubscriptionRole = 'premium'
): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: null,
    role,
    tier: role,
    lastLogin: NOW,
    descricao: '',
    billingProjectionVersion: 1,
    isSubscriber: true,
    monthlyPayer: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    subscriptionStartedAt: NOW - 60_000,
    subscriptionEndsAt: endsAt,
  };
}

function createFreeUser(): IUserDados {
  return {
    ...createUser(NOW + 60_000, 'basic'),
    role: 'free',
    tier: 'free',
    isSubscriber: false,
    monthlyPayer: false,
    subscriptionStatus: 'inactive',
    subscriptionScope: null,
    subscriptionStartedAt: null,
    subscriptionEndsAt: null,
  };
}

describe('PlatformSubscriptionAccessService', () => {
  let userSubject: BehaviorSubject<IUserDados | null | undefined>;
  let patchMock: ReturnType<typeof vi.fn>;
  let service: PlatformSubscriptionAccessService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    userSubject = new BehaviorSubject<IUserDados | null | undefined>(
      createUser(NOW + 100)
    );
    patchMock = vi.fn((partial: Partial<IUserDados>) => {
      const current = userSubject.value;
      if (!current) return;
      userSubject.next({ ...current, ...partial });
    });

    TestBed.configureTestingModule({
      providers: [
        PlatformSubscriptionAccessService,
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: userSubject.asObservable(),
            getSnapshot: () => userSubject.value,
            patch: patchMock,
          },
        },
      ],
    });

    service = TestBed.inject(PlatformSubscriptionAccessService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('expira reativamente sem nova emissão do Firestore', async () => {
    const states: boolean[] = [];
    const subscription = service.isSubscriber$.subscribe((active) => {
      states.push(active);
    });

    expect(states).toEqual([true]);

    await vi.advanceTimersByTimeAsync(151);

    expect(states).toEqual([true, false]);
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
    subscription.unsubscribe();
  });

  it('reage imediatamente quando a projeção muda', () => {
    const states: boolean[] = [];
    const subscription = service.isSubscriber$.subscribe((active) => {
      states.push(active);
    });

    userSubject.next({
      ...createUser(NOW + 60_000),
      isSubscriber: false,
      monthlyPayer: false,
      subscriptionStatus: 'inactive',
      subscriptionScope: null,
    });

    expect(states).toEqual([true, false]);
    subscription.unsubscribe();
  });

  it('propaga free -> basic -> premium -> vip sem reload', () => {
    userSubject.next(createFreeUser());

    const roles: Array<PlatformSubscriptionRole | null> = [];
    const subscribers: boolean[] = [];
    const roleSubscription = service.role$.subscribe((role) => roles.push(role));
    const subscriberSubscription = service.isSubscriber$.subscribe((active) => {
      subscribers.push(active);
    });

    userSubject.next(createUser(NOW + 60_000, 'basic'));
    userSubject.next(createUser(NOW + 60_000, 'premium'));
    userSubject.next(createUser(NOW + 60_000, 'vip'));

    expect(roles).toEqual([null, 'basic', 'premium', 'vip']);
    expect(subscribers).toEqual([false, true]);

    roleSubscription.unsubscribe();
    subscriberSubscription.unsubscribe();
  });
});
