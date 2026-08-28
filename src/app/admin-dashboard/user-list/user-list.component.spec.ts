// src/app/admin-dashboard/user-list/user-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserListComponent } from './user-list.component';
import { UserManagementService } from '../../core/services/account-moderation/user-management.service';
import { UserModerationService } from '../../core/services/account-moderation/user-moderation.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { AccountLifecycleService } from '../../account/application/account-lifecycle.service';

describe('UserListComponent', () => {
  let component: UserListComponent;
  let fixture: ComponentFixture<UserListComponent>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let scheduleDeletion: ReturnType<typeof vi.fn>;
  let showSuccess: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(false) }));
    scheduleDeletion = vi.fn(() =>
      of({ ok: true, accountStatus: 'pending_deletion' })
    );
    showSuccess = vi.fn();

    await TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        {
          provide: UserManagementService,
          useValue: {
            getAllUsers: vi.fn(() => of([])),
          },
        },
        {
          provide: UserModerationService,
          useValue: {
            suspendUser: vi.fn(() => of(void 0)),
            unsuspendUser: vi.fn(() => of(void 0)),
            lockAccount: vi.fn(() => of(void 0)),
            unlockAccount: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: AccountLifecycleService,
          useValue: {
            moderateScheduleDeletion$: scheduleDeletion,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showSuccess,
            showError: vi.fn(),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: dialogOpen,
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('deve agendar exclusão pelo lifecycle autorizado', () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteUser({
      uid: 'u1',
      email: 'target@example.com',
      photoURL: null,
      role: 'free',
      lastLogin: 0,
      isSubscriber: false,
      descricao: '',
      suspended: false,
      accountLocked: false,
      profileCompleted: true,
      actionPending: false,
      displayName: 'Target',
      adminSubtitle: '',
      profileStatusLabel: 'Perfil completo',
      operationalStatusLabel: 'Ativo',
      statusSeverity: 'success',
      lastActivity: 0,
      operationalPriority: 1,
    } as any);

    expect(scheduleDeletion).toHaveBeenCalledWith(
      'u1',
      'Exclusão agendada pela lista administrativa de usuários.'
    );
    expect(showSuccess).toHaveBeenCalledWith('Exclusão do usuário agendada.');
  });
});
