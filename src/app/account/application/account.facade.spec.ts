import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import type { PlatformSubscriptionAccessState } from 'src/app/core/services/subscriptions/platform-subscription-access.model';
import { PlatformSubscriptionAccessService } from 'src/app/core/services/subscriptions/platform-subscription-access.service';
import { AccountFacade } from './account.facade';

function user(role: IUserDados['role'] = 'free'): IUserDados {
  return {
    uid: 'user-1',
    nickname: 'serale',
    email: 'user@example.com',
    emailVerified: true,
    photoURL: null,
    role,
    tier: role === 'admin' ? 'free' : role,
    lastLogin: 1,
  } as IUserDados;
}

function subscription(
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

describe('AccountFacade canonical subscription state', () => {
  let userSubject: BehaviorSubject<IUserDados | null | undefined>;
  let authUserSubject: BehaviorSubject<any | null>;
  let subscriptionSubject: BehaviorSubject<PlatformSubscriptionAccessState>;

  beforeEach(() => {
    userSubject = new BehaviorSubject<IUserDados | null | undefined>(user());
    authUserSubject = new BehaviorSubject<any | null>({
      uid: 'user-1',
      email: 'user@example.com',
      emailVerified: true,
      providerData: [],
    });
    subscriptionSubject = new BehaviorSubject<PlatformSubscriptionAccessState>(
      subscription(null)
    );

    TestBed.configureTestingModule({
      providers: [
        AccountFacade,
        {
          provide: CurrentUserStoreService,
          useValue: { user$: userSubject.asObservable() },
        },
        {
          provide: AuthSessionService,
          useValue: { authUser$: authUserSubject.asObservable() },
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

  it('atualiza o plano visual imediatamente sem reload', () => {
    const facade = TestBed.inject(AccountFacade);
    const plans: Array<string | null> = [];
    const statuses: boolean[] = [];
    const sub = facade.vm$.subscribe((vm) => {
      plans.push(vm?.activePlanLabel ?? null);
      statuses.push(vm?.subscriptionActive ?? false);
    });

    subscriptionSubject.next(subscription('basic'));
    subscriptionSubject.next(subscription('premium'));
    subscriptionSubject.next(subscription('vip'));

    expect(plans).toEqual([null, 'Básico', 'Premium', 'VIP']);
    expect(statuses).toEqual([false, true, true, true]);
    sub.unsubscribe();
  });

  it('não exibe role pago local quando a assinatura canônica está inativa', () => {
    userSubject.next(user('basic'));
    const facade = TestBed.inject(AccountFacade);
    let roleLabel: string | null = null;
    const sub = facade.vm$.subscribe((vm) => {
      roleLabel = vm?.roleLabel ?? null;
    });

    expect(roleLabel).toBe('Gratuito');
    sub.unsubscribe();
  });

  it('preserva admin como papel administrativo', () => {
    userSubject.next(user('admin'));
    const facade = TestBed.inject(AccountFacade);
    let roleLabel: string | null = null;
    const sub = facade.vm$.subscribe((vm) => {
      roleLabel = vm?.roleLabel ?? null;
    });

    expect(roleLabel).toBe('Administrador');
    sub.unsubscribe();
  });
});
