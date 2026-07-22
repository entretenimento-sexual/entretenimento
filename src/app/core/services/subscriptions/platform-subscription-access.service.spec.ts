import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '../../interfaces/iuser-dados';
import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';
import { PlatformSubscriptionAccessService } from './platform-subscription-access.service';

const NOW = 1_800_000_000_000;

function createUser(endsAt: number): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: null,
    role: 'premium',
    tier: 'premium',
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

describe('PlatformSubscriptionAccessService', () => {
  let userSubject: BehaviorSubject<IUserDados | null | undefined>;
  let service: PlatformSubscriptionAccessService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    userSubject = new BehaviorSubject<IUserDados | null | undefined>(
      createUser(NOW + 100)
    );

    TestBed.configureTestingModule({
      providers: [
        PlatformSubscriptionAccessService,
        {
          provide: CurrentUserStoreService,
          useValue: { user$: userSubject.asObservable() },
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
});
