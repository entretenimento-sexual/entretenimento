import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '../../../interfaces/iuser-dados';
import { PlatformSubscriptionAccessService } from '../../subscriptions/platform-subscription-access.service';
import type { PlatformSubscriptionAccessState } from '../../subscriptions/platform-subscription-access.model';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { AccessControlService } from './access-control.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthRouteContextService } from './auth-route-context.service';
import { AuthSessionService } from './auth-session.service';
import { CurrentUserStoreService } from './current-user-store.service';

function createUser(role: IUserDados['role'] = 'free'): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: null,
    role,
    tier: role === 'admin' ? 'free' : role,
    lastLogin: 1,
    profileCompleted: true,
  } as IUserDados;
}

function createSubscriptionState(
  role: 'basic' | 'premium' | 'vip' | null
): PlatformSubscriptionAccessState {
  return role
    ? {
        active: true,
        role,
        startsAt: 1,
        endsAt: Number.MAX_SAFE_INTEGER,
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

describe('AccessControlService canonical subscription roles', () => {
  let user$: BehaviorSubject<IUserDados | null | undefined>;
  let subscriptionState$: BehaviorSubject<PlatformSubscriptionAccessState>;
  let subscriptionIsFree$: BehaviorSubject<boolean>;
  let subscriptionIsSubscriber$: BehaviorSubject<boolean>;

  beforeEach(() => {
    user$ = new BehaviorSubject<IUserDados | null | undefined>(createUser());
    subscriptionState$ = new BehaviorSubject<PlatformSubscriptionAccessState>(
      createSubscriptionState(null)
    );
    subscriptionIsFree$ = new BehaviorSubject<boolean>(true);
    subscriptionIsSubscriber$ = new BehaviorSubject<boolean>(false);

    TestBed.configureTestingModule({
      providers: [
        AccessControlService,
        {
          provide: AuthSessionService,
          useValue: {
            ready$: new BehaviorSubject(true),
            authUser$: new BehaviorSubject({
              uid: 'user-1',
              emailVerified: true,
            }),
            currentAuthUser: {
              uid: 'user-1',
              emailVerified: true,
            },
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: user$.asObservable(),
            getSnapshot: () => user$.value,
          },
        },
        {
          provide: PlatformSubscriptionAccessService,
          useValue: {
            state$: subscriptionState$.asObservable(),
            isFree$: subscriptionIsFree$.asObservable(),
            isSubscriber$: subscriptionIsSubscriber$.asObservable(),
          },
        },
        {
          provide: AuthAppBlockService,
          useValue: {
            reason$: new BehaviorSubject(null),
          },
        },
        {
          provide: AuthRouteContextService,
          useValue: {
            context$: new BehaviorSubject({
              routerReady: true,
              currentUrl: '/dashboard/principal',
              navPath: '/dashboard/principal',
              inRegistrationFlow: false,
            }),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError: vi.fn() },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            canLog: vi.fn(() => false),
            log: vi.fn(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('usa a assinatura canônica para basic/premium/vip', async () => {
    const service = TestBed.inject(AccessControlService);

    expect(await firstValueFrom(service.hasAtLeast$('basic'))).toBe(false);

    subscriptionState$.next(createSubscriptionState('premium'));

    expect(await firstValueFrom(service.hasAtLeast$('basic'))).toBe(true);
    expect(await firstValueFrom(service.hasAny$(['premium']))).toBe(true);
    expect(await firstValueFrom(service.hasAny$(['vip']))).toBe(false);
  });

  it('preserva admin como papel administrativo separado da assinatura', async () => {
    user$.next(createUser('admin'));
    const service = TestBed.inject(AccessControlService);

    expect(await firstValueFrom(service.hasAny$(['admin']))).toBe(true);
    expect(await firstValueFrom(service.hasAtLeast$('vip'))).toBe(true);
  });

  it('propaga free e subscriber diretamente da fonte canônica', () => {
    const service = TestBed.inject(AccessControlService);
    const freeStates: boolean[] = [];
    const subscriberStates: boolean[] = [];

    const freeSubscription = service.isFree$.subscribe((value) =>
      freeStates.push(value)
    );
    const subscriberSubscription = service.isSubscriber$.subscribe((value) =>
      subscriberStates.push(value)
    );

    subscriptionIsFree$.next(false);
    subscriptionIsSubscriber$.next(true);

    expect(freeStates).toEqual([true, false]);
    expect(subscriberStates).toEqual([false, true]);

    freeSubscription.unsubscribe();
    subscriberSubscription.unsubscribe();
  });
});
