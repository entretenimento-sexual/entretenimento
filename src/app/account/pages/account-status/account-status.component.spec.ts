import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { AccountLifecycleFacade } from '../../application/account-lifecycle.facade';
import { AccountLifecycleService } from '../../application/account-lifecycle.service';
import { AccountReauthenticationService } from '../../application/account-reauthentication.service';
import { AccountStatusComponent } from './account-status.component';

function user(overrides: Partial<IUserDados> = {}): IUserDados {
  return {
    uid: 'user-1',
    email: null,
    photoURL: null,
    role: 'free',
    lastLogin: 1,
    descricao: '',
    isSubscriber: false,
    accountStatus: 'self_suspended',
    ...overrides,
  } as IUserDados;
}

describe('AccountStatusComponent', () => {
  const patch = vi.fn();
  const navigate = vi.fn(() => Promise.resolve(true));
  const showSuccess = vi.fn();
  const showInfo = vi.fn();
  const reactivateSelfSuspension$ = vi.fn();
  const cancelAccountDeletion$ = vi.fn();
  const reauthenticateForSensitiveAction$ = vi.fn(() => of(void 0));
  let currentUser$: BehaviorSubject<IUserDados | null | undefined>;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUser$ = new BehaviorSubject<IUserDados | null | undefined>(user());

    reactivateSelfSuspension$.mockReturnValue(
      of({
        ok: true,
        accountStatus: 'active',
        publicVisibility: 'hidden',
        interactionBlocked: true,
        suspended: false,
        statusUpdatedAt: 123,
        message: 'Conta reativada, mas ainda privada.',
      })
    );

    cancelAccountDeletion$.mockReturnValue(
      of({
        ok: true,
        accountStatus: 'active',
        publicVisibility: 'hidden',
        interactionBlocked: true,
        suspended: false,
        statusUpdatedAt: 456,
        message: 'Exclusão cancelada, mas ainda privada.',
      })
    );

    await TestBed.configureTestingModule({
      imports: [AccountStatusComponent],
      providers: [
        {
          provide: Router,
          useValue: { navigate },
        },
        {
          provide: AccountLifecycleFacade,
          useValue: {
            lifecycleState$: of({ accountStatus: 'self_suspended' }),
            statusVm$: of({
              title: 'Conta suspensa',
              description: 'Descrição',
              badgeLabel: 'Suspensa',
              isBlocked: true,
              canReactivateSelfSuspension: true,
              canCancelDeletion: false,
              canGoToAccountHome: false,
              suspensionReason: null,
              suspensionEndsAt: null,
              deletionUndoUntil: null,
              purgeAfter: null,
            }),
          },
        },
        {
          provide: AccountLifecycleService,
          useValue: {
            reactivateSelfSuspension$,
            cancelAccountDeletion$,
          },
        },
        {
          provide: AccountReauthenticationService,
          useValue: {
            getCurrentMode: vi.fn(() => 'password'),
            reauthenticateForSensitiveAction$,
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: currentUser$.asObservable(),
            patch,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showSuccess, showInfo },
        },
      ],
    }).compileComponents();
  });

  it('abre confirmação antes de reativar a conta', () => {
    const fixture = TestBed.createComponent(AccountStatusComponent);
    const component = fixture.componentInstance;

    component.onReactivateSelfSuspension();

    expect(component.lifecycleDialogIntent()).toBe('reactivate_self_suspend');
    expect(reactivateSelfSuspension$).not.toHaveBeenCalled();
  });

  it('aguarda a hidratação canônica antes de navegar após reativação', () => {
    const fixture = TestBed.createComponent(AccountStatusComponent);
    const component = fixture.componentInstance;

    component.onLifecycleDialogConfirmed({
      intent: 'reactivate_self_suspend',
      password: 'senha-atual',
    });

    expect(reauthenticateForSensitiveAction$).toHaveBeenCalledWith(
      'senha-atual'
    );
    expect(reactivateSelfSuspension$).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();

    currentUser$.next(
      user({
        accountStatus: 'active',
        suspended: false,
        publicVisibility: 'hidden',
        interactionBlocked: true,
      })
    );

    expect(showSuccess).toHaveBeenCalledWith(
      'Conta reativada, mas ainda privada.'
    );
    expect(navigate).toHaveBeenCalledWith(['/conta'], { replaceUrl: true });
    expect(patch).not.toHaveBeenCalled();
  });

  it('não navega para fluxo regular se a hidratação revelar lock técnico', () => {
    const fixture = TestBed.createComponent(AccountStatusComponent);
    const component = fixture.componentInstance;

    component.onLifecycleDialogConfirmed({
      intent: 'reactivate_self_suspend',
      password: 'senha-atual',
    });

    currentUser$.next(
      user({
        accountStatus: 'active',
        suspended: false,
        accountLocked: true,
      })
    );

    expect(showSuccess).toHaveBeenCalledWith(
      'Conta reativada, mas ainda privada.'
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('aguarda o backend sair de pending_deletion antes de navegar', () => {
    currentUser$.next(
      user({
        accountStatus: 'pending_deletion',
        suspended: false,
      })
    );
    const fixture = TestBed.createComponent(AccountStatusComponent);
    const component = fixture.componentInstance;

    component.onLifecycleDialogConfirmed({
      intent: 'cancel_pending_deletion',
      password: 'senha-atual',
    });

    expect(cancelAccountDeletion$).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();

    currentUser$.next(
      user({
        accountStatus: 'active',
        suspended: false,
        deletionRequestedAt: null,
        deletionUndoUntil: null,
        purgeAfter: null,
      })
    );

    expect(showSuccess).toHaveBeenCalledWith(
      'Exclusão cancelada, mas ainda privada.'
    );
    expect(navigate).toHaveBeenCalledWith(['/conta'], { replaceUrl: true });
    expect(patch).not.toHaveBeenCalled();
  });
});
