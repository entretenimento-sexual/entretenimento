import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '../../../interfaces/iuser-dados';
import { PlatformSubscriptionAccessService } from '../../subscriptions/platform-subscription-access.service';
import type { PlatformSubscriptionAccessState } from '../../subscriptions/platform-subscription-access.model';
import { ApplicationErrorService } from '../../error-handler/application-error.service';
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
    isSubscriber: role !== 'free' && role !== 'admin',
    ageEligibility: {
      status: 'VERIFIED_ADULT',
      policyVersion: 1,
      source: 'INITIAL_VERIFICATION',
      method: 'EXTERNAL_PROVIDER',
      verifiedAtMs: 1,
      expiresAtMs: null,
      updatedAtMs: 1,
    },
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
  const applicationErrorReport = vi.fn();

  let user$: BehaviorSubject<IUserDados | null | undefined>;
  let authReady$: BehaviorSubject<boolean>;
  let authUser$: BehaviorSubject<{ uid: string; emailVerified: boolean } | null>;
  let subscriptionState$: BehaviorSubject<PlatformSubscriptionAccessState>;
  let subscriptionIsFree$: BehaviorSubject<boolean>;
  let subscriptionIsSubscriber$: BehaviorSubject<boolean>;

  beforeEach(() => {
    vi.clearAllMocks();

    user$ = new BehaviorSubject<IUserDados | null | undefined>(createUser());
    authReady$ = new BehaviorSubject<boolean>(true);
    authUser$ = new BehaviorSubject<{ uid: string; emailVerified: boolean } | null>({
      uid: 'user-1',
      emailVerified: true,
    });
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
            ready$: authReady$.asObservable(),
            authUser$: authUser$.asObservable(),
            get currentAuthUser() {
              return authUser$.value;
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
          provide: ApplicationErrorService,
          useValue: { report: applicationErrorReport },
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('libera recursos sociais pela conta ativa com contrato vigente', async () => {
    user$.next({
      ...createUser(),
      acceptedTerms: {
        accepted: true,
        date: 1,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
      ageReverification: { status: 'NONE' },
    });

    const service = TestBed.inject(AccessControlService);

    await expect(firstValueFrom(service.canUseAdultSocial$))
      .resolves.toBe(true);
    await expect(firstValueFrom(service.canRunPresence$))
      .resolves.toBe(true);
  });

  it('reage a mudanças do contrato da conta sem reinterpretar maioridade', async () => {
    user$.next({
      ...createUser(),
      acceptedTerms: {
        accepted: false,
        date: 1,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
      ageReverification: { status: 'NONE' },
    });

    const service = TestBed.inject(AccessControlService);
    const states: boolean[] = [];
    const subscription = service.canUseAdultSocial$.subscribe((value) =>
      states.push(value)
    );

    user$.next({
      ...createUser(),
      acceptedTerms: {
        accepted: true,
        date: 1,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
      ageReverification: { status: 'NONE' },
    });

    expect(states).toEqual([false, true]);
    subscription.unsubscribe();
  });

  it('não reinterpreta autodeclaração em uma conta já admitida e ativa', async () => {
    user$.next({
      ...createUser(),
      acceptedTerms: {
        accepted: true,
        date: 1,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
      ageEligibility: {
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        verifiedAtMs: null,
        expiresAtMs: null,
        updatedAtMs: 2,
      },
    });

    const service = TestBed.inject(AccessControlService);

    await expect(firstValueFrom(service.canUseAdultSocial$))
      .resolves.toBe(true);
    await expect(firstValueFrom(service.canEnterCore$))
      .resolves.toBe(true);
  });

  it('expiração de assurance não derruba capability de uma conta ativa', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    user$.next({
      ...createUser(),
      acceptedTerms: {
        accepted: true,
        date: 1,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
      ageEligibility: {
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'INITIAL_VERIFICATION',
        method: 'EXTERNAL_PROVIDER',
        verifiedAtMs: now - 1_000,
        expiresAtMs: now + 100,
        updatedAtMs: now,
      },
    });

    const service = TestBed.inject(AccessControlService);
    const states: boolean[] = [];
    const subscription = service.canUseAdultSocial$.subscribe((value) =>
      states.push(value)
    );

    expect(states.at(-1)).toBe(true);
    await vi.advanceTimersByTimeAsync(101);
    expect(states.at(-1)).toBe(true);
    subscription.unsubscribe();
  });

  it('respeita hold temporário e libera novamente sem reload quando ele expira', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    user$.next({
      ...createUser(),
      acceptedTerms: {
        accepted: true,
        date: 1,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
      ageReverification: { status: 'NONE' },
      moderationAutomationHold: {
        active: true,
        source: 'automation',
        reason: 'critical_report_volume',
        triggerReportId: 'report-1',
        appliedAtMs: now,
        expiresAtMs: now + 100,
      },
    });

    const service = TestBed.inject(AccessControlService);
    const states: boolean[] = [];
    const subscription = service.canUseAdultSocial$.subscribe((value) =>
      states.push(value)
    );

    expect(states.at(-1)).toBe(false);

    await vi.advanceTimersByTimeAsync(101);

    expect(states.at(-1)).toBe(true);
    subscription.unsubscribe();
  });

  it('não transforma reverificação em gate local quando lifecycle permanece liberado', async () => {
    user$.next({
      ...createUser(),
      acceptedTerms: {
        accepted: true,
        date: 1,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
      ageReverification: { status: 'UNDER_REVIEW' },
    });

    const service = TestBed.inject(AccessControlService);

    await expect(firstValueFrom(service.canUseAdultSocial$))
      .resolves.toBe(true);
  });

  it('diagnostica toda falha e limita feedback visual a uma vez por 15 segundos', async () => {
    const service = TestBed.inject(AccessControlService);
    const firstError = new Error('first');
    const secondError = new Error('second');

    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(20_000)
      .mockReturnValueOnce(25_000);

    const firstFallback = await firstValueFrom(
      (service as any).handleStreamError('test$', false)(firstError)
    );
    const secondFallback = await firstValueFrom(
      (service as any).handleStreamError('test$', false)(secondError)
    );

    expect(firstFallback).toBe(false);
    expect(secondFallback).toBe(false);
    expect(applicationErrorReport).toHaveBeenCalledTimes(2);

    expect(applicationErrorReport).toHaveBeenNthCalledWith(1, firstError, {
      feature: 'access-control',
      operation: 'test$',
      fallbackMessage: 'Falha ao validar acesso. Tente novamente.',
      presentation: { surface: 'snackbar', severity: 'error' },
      metadata: {
        scope: 'AccessControlService',
        context: 'test$',
      },
    });

    expect(applicationErrorReport).toHaveBeenNthCalledWith(2, secondError, {
      feature: 'access-control',
      operation: 'test$',
      fallbackMessage: 'Falha ao validar acesso. Tente novamente.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'AccessControlService',
        context: 'test$',
      },
    });
  });

  it('volta a permitir feedback visual após a janela de 15 segundos', async () => {
    const service = TestBed.inject(AccessControlService);
    const firstError = new Error('first');
    const secondError = new Error('second');

    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(20_000)
      .mockReturnValueOnce(36_001);

    await firstValueFrom(
      (service as any).handleStreamError('first$', false)(firstError)
    );
    await firstValueFrom(
      (service as any).handleStreamError('second$', true)(secondError)
    );

    expect(applicationErrorReport).toHaveBeenNthCalledWith(
      1,
      firstError,
      expect.objectContaining({
        presentation: { surface: 'snackbar', severity: 'error' },
      })
    );
    expect(applicationErrorReport).toHaveBeenNthCalledWith(
      2,
      secondError,
      expect.objectContaining({
        presentation: { surface: 'snackbar', severity: 'error' },
      })
    );
  });

  it('preserva o fallback fail-closed se a camada canônica de diagnóstico falhar', async () => {
    const service = TestBed.inject(AccessControlService);
    applicationErrorReport.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    vi.spyOn(Date, 'now').mockReturnValueOnce(20_000);

    await expect(
      firstValueFrom(
        (service as any).handleStreamError('canRunApp$', false)(
          new Error('stream failed')
        )
      )
    ).resolves.toBe(false);

    expect(applicationErrorReport).toHaveBeenCalledTimes(1);
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

  it('falha fechado enquanto o perfil do usuário autenticado não foi hidratado', async () => {
    user$.next(undefined);
    const service = TestBed.inject(AccessControlService);

    expect(await firstValueFrom(service.accountStatus$)).toBe('unknown');
    expect(await firstValueFrom(service.isLifecycleBlocked$)).toBe(true);
    expect(await firstValueFrom(service.canRunApp$)).toBe(false);
  });

  it('trata lock técnico como lifecycle bloqueado mesmo com status nominal ativo', async () => {
    user$.next({
      ...createUser(),
      accountStatus: 'active',
      accountLocked: true,
    });
    const service = TestBed.inject(AccessControlService);

    expect(await firstValueFrom(service.accountStatus$)).toBe('locked');
    expect(await firstValueFrom(service.isLifecycleBlocked$)).toBe(true);
    expect(await firstValueFrom(service.canEnterCore$)).toBe(false);
  });

  it('não classifica guest resolvido como conta bloqueada', async () => {
    authUser$.next(null);
    user$.next(null);
    const service = TestBed.inject(AccessControlService);

    expect(await firstValueFrom(service.accountStatus$)).toBe('active');
    expect(await firstValueFrom(service.isLifecycleBlocked$)).toBe(false);
    expect(await firstValueFrom(service.isAuthenticated$)).toBe(false);
  });
});
