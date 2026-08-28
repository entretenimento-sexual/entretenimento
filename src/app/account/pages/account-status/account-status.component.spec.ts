import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { AccountLifecycleFacade } from '../../application/account-lifecycle.facade';
import { AccountLifecycleService } from '../../application/account-lifecycle.service';
import { AccountReauthenticationService } from '../../application/account-reauthentication.service';
import { AccountStatusComponent } from './account-status.component';

describe('AccountStatusComponent', () => {
  const patch = vi.fn();
  const navigate = vi.fn(() => Promise.resolve(true));
  const showSuccess = vi.fn();
  const reactivateSelfSuspension$ = vi.fn();
  const cancelAccountDeletion$ = vi.fn();
  const reauthenticateForSensitiveAction$ = vi.fn(() => of(void 0));

  beforeEach(async () => {
    vi.clearAllMocks();

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
          useValue: { patch },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showSuccess },
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

  it('não torna pública uma conta reativada que o backend manteve privada', () => {
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
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        accountStatus: 'active',
        publicVisibility: 'hidden',
        interactionBlocked: true,
      })
    );
    expect(showSuccess).toHaveBeenCalledWith(
      'Conta reativada, mas ainda privada.'
    );
  });

  it('preserva restrições devolvidas ao cancelar a exclusão', () => {
    const fixture = TestBed.createComponent(AccountStatusComponent);
    const component = fixture.componentInstance;

    component.onLifecycleDialogConfirmed({
      intent: 'cancel_pending_deletion',
      password: 'senha-atual',
    });

    expect(reauthenticateForSensitiveAction$).toHaveBeenCalledWith(
      'senha-atual'
    );
    expect(cancelAccountDeletion$).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        accountStatus: 'active',
        publicVisibility: 'hidden',
        interactionBlocked: true,
        deletionRequestedAt: null,
        deletionUndoUntil: null,
        purgeAfter: null,
      })
    );
  });
});
