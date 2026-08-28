import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import type { PlatformSubscriptionAccessState } from 'src/app/core/services/subscriptions/platform-subscription-access.model';
import { PlatformSubscriptionAccessService } from 'src/app/core/services/subscriptions/platform-subscription-access.service';
import { AuthenticatedNavigationService } from './authenticated-navigation.service';

function createUser(): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: null,
    nickname: 'serale',
    role: 'free',
    tier: 'free',
    lastLogin: 1,
  } as IUserDados;
}

function subscriptionState(
  role: 'basic' | 'premium' | 'vip' | null
): PlatformSubscriptionAccessState {
  if (!role) {
    return {
      active: false,
      role: null,
      startsAt: null,
      endsAt: null,
      projectionVersion: 1,
      reason: 'inactive-flag',
    };
  }

  return {
    active: true,
    role,
    startsAt: 1,
    endsAt: Number.MAX_SAFE_INTEGER,
    projectionVersion: 1,
    reason: null,
  };
}

describe('AuthenticatedNavigationService subscription reactivity', () => {
  let userSubject: BehaviorSubject<IUserDados | null>;
  let subscriptionSubject: BehaviorSubject<PlatformSubscriptionAccessState>;

  beforeEach(() => {
    userSubject = new BehaviorSubject<IUserDados | null>(createUser());
    subscriptionSubject = new BehaviorSubject<PlatformSubscriptionAccessState>(
      subscriptionState(null)
    );

    TestBed.configureTestingModule({
      providers: [
        AuthenticatedNavigationService,
        {
          provide: Router,
          useValue: {
            url: '/dashboard/principal',
            events: new Subject().asObservable(),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            ready$: new BehaviorSubject(true),
            uid$: new BehaviorSubject<string | null>('user-1'),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: userSubject.asObservable(),
          },
        },
        {
          provide: PlatformSubscriptionAccessService,
          useValue: {
            state$: subscriptionSubject.asObservable(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('emite cada troca de plano mesmo sem mudar usuário ou rota', () => {
    const service = TestBed.inject(AuthenticatedNavigationService);
    const roles: string[] = [];
    const subscription = service.vm$.subscribe((vm) => {
      roles.push(vm.subscriptionRole);
    });

    subscriptionSubject.next(subscriptionState('basic'));
    subscriptionSubject.next(subscriptionState('premium'));
    subscriptionSubject.next(subscriptionState('vip'));

    expect(roles).toEqual(['free', 'basic', 'premium', 'vip']);
    subscription.unsubscribe();
  });

  it('volta para free quando a assinatura deixa de estar ativa', () => {
    const service = TestBed.inject(AuthenticatedNavigationService);
    const roles: string[] = [];
    const subscription = service.vm$.subscribe((vm) => {
      roles.push(vm.subscriptionRole);
    });

    subscriptionSubject.next(subscriptionState('vip'));
    subscriptionSubject.next(subscriptionState(null));

    expect(roles).toEqual(['free', 'vip', 'free']);
    subscription.unsubscribe();
  });
});
