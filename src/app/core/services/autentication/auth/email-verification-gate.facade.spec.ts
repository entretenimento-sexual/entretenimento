import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessControlService } from './access-control.service';
import { AuthSessionService } from './auth-session.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { EmailVerificationGateFacade } from './email-verification-gate.facade';
import { ApplicationErrorService } from '../../error-handler/application-error.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { EmailVerificationService } from '../register/email-verification.service';

describe('EmailVerificationGateFacade canonical errors', () => {
  let routerEvents$: Subject<unknown>;
  let routerMock: any;
  let isAuthenticated$: BehaviorSubject<boolean>;
  let profileCompleted$: BehaviorSubject<boolean>;
  let emailVerified$: BehaviorSubject<boolean>;
  let inRegistrationFlow$: BehaviorSubject<boolean>;
  let authUser$: BehaviorSubject<any>;
  let appUser$: BehaviorSubject<any>;

  let report: ReturnType<typeof vi.fn>;
  let showError: ReturnType<typeof vi.fn>;
  let showSuccess: ReturnType<typeof vi.fn>;
  let resendVerificationEmail: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    routerEvents$ = new Subject<unknown>();
    routerMock = {
      events: routerEvents$,
      url: '/dashboard/principal?tab=feed',
      routerState: {
        snapshot: {
          root: {
            data: {},
            firstChild: null,
          },
        },
      },
    };

    isAuthenticated$ = new BehaviorSubject(true);
    profileCompleted$ = new BehaviorSubject(true);
    emailVerified$ = new BehaviorSubject(false);
    inRegistrationFlow$ = new BehaviorSubject(false);
    authUser$ = new BehaviorSubject({
      uid: 'user-1',
      email: 'user@example.com',
      emailVerified: false,
    });
    appUser$ = new BehaviorSubject({
      uid: 'user-1',
      emailVerified: false,
      profileCompleted: true,
    });

    report = vi.fn();
    showError = vi.fn();
    showSuccess = vi.fn();
    resendVerificationEmail = vi.fn(() => of('ok'));

    TestBed.configureTestingModule({
      providers: [
        EmailVerificationGateFacade,
        {
          provide: AccessControlService,
          useValue: {
            isAuthenticated$: isAuthenticated$.asObservable(),
            profileCompleted$: profileCompleted$.asObservable(),
            emailVerified$: emailVerified$.asObservable(),
            inRegistrationFlow$: inRegistrationFlow$.asObservable(),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            authUser$: authUser$.asObservable(),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: appUser$.asObservable(),
          },
        },
        {
          provide: Router,
          useValue: routerMock,
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError, showSuccess },
        },
        {
          provide: EmailVerificationService,
          useValue: { resendVerificationEmail },
        },
      ],
    });
  });

  it('mantém o banner derivado sem diagnóstico no caminho normal', async () => {
    const facade = TestBed.inject(EmailVerificationGateFacade);

    await expect(firstValueFrom(facade.vm$)).resolves.toEqual(
      expect.objectContaining({
        mode: 'soft',
        email: 'user@example.com',
        showResend: true,
        currentUrl: '/dashboard/principal',
      })
    );

    expect(report).not.toHaveBeenCalled();
  });

  it('diagnostica falha interna de rota silenciosamente e devolve fallback seguro', async () => {
    const facade = TestBed.inject(EmailVerificationGateFacade);
    const values: any[] = [];
    const subscription = (facade as any).activeRouteMeta$.subscribe((value: any) =>
      values.push(value)
    );
    const original = new Error('router failed');

    routerEvents$.error(original);

    expect(values.at(-1)).toEqual({
      currentUrl: '/dashboard/principal',
      requireVerified: false,
    });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(original, {
      feature: 'email-verification-gate',
      operation: 'EmailVerificationGateFacade.activeRouteMeta$',
      fallbackMessage:
        'Não foi possível atualizar o estado interno da verificação de e-mail.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'EmailVerificationGateFacade',
        context: 'EmailVerificationGateFacade.activeRouteMeta$',
      },
    });

    subscription.unsubscribe();
  });

  it('não rediagnostica falha de reenvio já pertencente ao EmailVerificationService', () => {
    resendVerificationEmail.mockReturnValue(
      throwError(() => new Error('lower layer already diagnosed'))
    );
    const facade = TestBed.inject(EmailVerificationGateFacade);

    facade.resend();

    expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(
      'Não foi possível reenviar o e-mail de verificação.'
    );
  });

  it('mantém sucesso do reenvio como apresentação local sem diagnóstico técnico', () => {
    const facade = TestBed.inject(EmailVerificationGateFacade);

    facade.resend();

    expect(showSuccess).toHaveBeenCalledWith(
      'E-mail de verificação reenviado.'
    );
    expect(showError).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('mantém throttle de 15 segundos apenas para a mensagem de erro de reenvio', () => {
    resendVerificationEmail.mockReturnValue(
      throwError(() => new Error('lower layer already diagnosed'))
    );
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(20_000)
      .mockReturnValueOnce(25_000);

    const facade = TestBed.inject(EmailVerificationGateFacade);

    facade.resend();
    facade.resend();

    expect(resendVerificationEmail).toHaveBeenCalledTimes(2);
    expect(showError).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('preserva fallback interno se a própria camada canônica falhar', async () => {
    report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    const facade = TestBed.inject(EmailVerificationGateFacade);
    const fallback = await firstValueFrom(
      (facade as any).reportSilent(
        new Error('route failed'),
        'EmailVerificationGateFacade.test$'
      ) ?? of(void 0)
    );

    expect(fallback).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
