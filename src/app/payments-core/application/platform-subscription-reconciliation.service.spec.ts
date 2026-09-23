import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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
  let user$: BehaviorSubject<IUserDados | null | undefined>;
  let getSnapshotMock: ReturnType<typeof vi.fn>;
  let patchMock: ReturnType<typeof vi.fn>;
  let globalErrorMock: ReturnType<typeof vi.fn>;
  let service: PlatformSubscriptionReconciliationService;

  beforeEach(() => {
    ready$ = new BehaviorSubject<boolean>(true);
    uid$ = new BehaviorSubject<string | null>('u1');
    user$ = new BehaviorSubject<IUserDados | null | undefined>({
      ...CURRENT_USER,
    });
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
        recurringConfigured: true,
        renewalEnabled: true,
        renewalStatus: 'active',
        renewalCancellationPending: false,
      })
    );
    patchMock = vi.fn();
    globalErrorMock = vi.fn();

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
            user$: user$.asObservable(),
            patch: patchMock,
          },
        },
        {
          provide: BillingRepository,
          useValue: { getMyBillingSnapshot$: getSnapshotMock },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: globalErrorMock },
        },
      ],
    });

    service = TestBed.inject(PlatformSubscriptionReconciliationService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('aciona a reconciliação backend quando sessão e perfil apontam para o mesmo uid', () => {
    service.start();

    expect(getSnapshotMock).toHaveBeenCalledTimes(1);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('aguarda a hidratação do perfil atual', () => {
    user$.next(undefined);
    service.start();

    expect(getSnapshotMock).not.toHaveBeenCalled();

    user$.next({ ...CURRENT_USER });

    expect(getSnapshotMock).toHaveBeenCalledTimes(1);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('não reconcilia quando o perfil hidratado pertence a outro uid', () => {
    user$.next({
      ...CURRENT_USER,
      uid: 'u2',
    });

    service.start();

    expect(getSnapshotMock).not.toHaveBeenCalled();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('reconcilia novamente após logout e login do mesmo usuário', () => {
    service.start();
    uid$.next(null);
    uid$.next('u1');

    expect(getSnapshotMock).toHaveBeenCalledTimes(2);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('reporta falha de reconciliação sem fabricar estado financeiro local', () => {
    getSnapshotMock.mockReturnValueOnce(
      throwError(() => new Error('billing unavailable'))
    );

    service.start();

    expect(globalErrorMock).toHaveBeenCalledTimes(1);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('não repete a callable em mudanças do mesmo perfil sem troca de sessão', () => {
    service.start();

    user$.next({
      ...CURRENT_USER,
      nickname: 'novo-apelido',
    });

    expect(getSnapshotMock).toHaveBeenCalledTimes(1);
    expect(patchMock).not.toHaveBeenCalled();
  });
});
