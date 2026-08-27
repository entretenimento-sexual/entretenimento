import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IUserDados } from '../interfaces/iuser-dados';
import { CurrentUserStoreService } from '../services/autentication/auth/current-user-store.service';
import type { PlatformSubscriptionAccessState } from '../services/subscriptions/platform-subscription-access.model';
import { PlatformSubscriptionAccessService } from '../services/subscriptions/platform-subscription-access.service';
import { createSubscriberContentAccessPolicy } from './content-access-policy.model';
import { ContentAccessPolicyService } from './content-access-policy.service';

function user(role: IUserDados['role'] = 'free'): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: 'https://example.com/photo.jpg',
    role,
    tier: role === 'admin' ? 'free' : role,
    lastLogin: 1,
    profileCompleted: true,
    accountStatus: 'active',
    loginAllowed: true,
    initialAdultConsentRequired: true,
    adultConsent: {
      accepted: true,
      version: '1',
    },
  } as IUserDados;
}

function subscription(
  role: 'basic' | 'premium' | 'vip' | null
): PlatformSubscriptionAccessState {
  return role
    ? {
        active: true,
        role,
        startsAt: Date.now() - 60_000,
        endsAt: Date.now() + 60_000,
        projectionVersion: 1,
        reason: null,
      }
    : {
        active: false,
        role: null,
        startsAt: null,
        endsAt: null,
        projectionVersion: 1,
        reason: 'inactive-flag',
      };
}

describe('ContentAccessPolicyService canonical runtime subscription', () => {
  let userSubject: BehaviorSubject<IUserDados | null | undefined>;
  let subscriptionSubject: BehaviorSubject<PlatformSubscriptionAccessState>;

  beforeEach(() => {
    userSubject = new BehaviorSubject<IUserDados | null | undefined>(user());
    subscriptionSubject = new BehaviorSubject<PlatformSubscriptionAccessState>(
      subscription(null)
    );

    TestBed.configureTestingModule({
      providers: [
        ContentAccessPolicyService,
        {
          provide: CurrentUserStoreService,
          useValue: { user$: userSubject.asObservable() },
        },
        {
          provide: PlatformSubscriptionAccessService,
          useValue: { state$: subscriptionSubject.asObservable() },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('libera conteúdo pago assim que a stream canônica sobe de free para premium', () => {
    const service = TestBed.inject(ContentAccessPolicyService);
    const decisions: Array<string | null> = [];
    const sub = service
      .evaluate$(createSubscriberContentAccessPolicy('premium'))
      .subscribe((decision) => decisions.push(decision.reason));

    subscriptionSubject.next(subscription('premium'));

    expect(decisions).toEqual(['role_insufficient', null]);
    sub.unsubscribe();
  });

  it('não confia em role pago residual do usuário quando entitlement está inativo', () => {
    userSubject.next(user('vip'));
    const service = TestBed.inject(ContentAccessPolicyService);
    let allowed = true;
    const sub = service
      .canAccess$(createSubscriberContentAccessPolicy('basic'))
      .subscribe((value) => {
        allowed = value;
      });

    expect(allowed).toBe(false);
    sub.unsubscribe();
  });

  it('preserva admin separado da assinatura', () => {
    userSubject.next(user('admin'));
    const service = TestBed.inject(ContentAccessPolicyService);
    let allowed = false;
    const sub = service
      .canAccess$(createSubscriberContentAccessPolicy('vip'))
      .subscribe((value) => {
        allowed = value;
      });

    expect(allowed).toBe(true);
    sub.unsubscribe();
  });
});
