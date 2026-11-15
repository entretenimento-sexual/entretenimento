// src/app/admin-dashboard/user-list/user-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserListComponent } from './user-list.component';
import { AdminUsersPageService } from '../../core/services/account-moderation/admin-users-page.service';
import { UserModerationService } from '../../core/services/account-moderation/user-moderation.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { AccountLifecycleService } from '../../account/application/account-lifecycle.service';

describe('UserListComponent', () => {
  let component: UserListComponent;
  let fixture: ComponentFixture<UserListComponent>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let scheduleDeletion: ReturnType<typeof vi.fn>;
  let showSuccess: ReturnType<typeof vi.fn>;
  let pageRequest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(false) }));
    scheduleDeletion = vi.fn(() =>
      of({ ok: true, accountStatus: 'pending_deletion' })
    );
    showSuccess = vi.fn();
    pageRequest = vi.fn(() => of({
      items: [],
      nextCursor: null,
      hasMore: false,
    }));

    await TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        {
          provide: AdminUsersPageService,
          useValue: {
            getAdminUsersPage$: pageRequest,
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

  it('requests the first page from the backend', () => {
    expect(pageRequest).toHaveBeenCalledWith({
      cursor: null,
      limit: 25,
    });
  });

  it('navigates with server cursors', () => {
    const row = {
      uid: 'user_1',
      nickname: 'social-user',
      profileCompleted: true,
      accountStatus: 'active',
      suspended: false,
      accountLocked: false,
      interactionBlocked: false,
      loginAllowed: true,
    };

    pageRequest.mockReturnValueOnce(of({
      items: [row],
      nextCursor: 'user_1',
      hasMore: true,
    }));

    component.loadUsers();

    pageRequest.mockReturnValueOnce(of({
      items: [{ ...row, uid: 'user_2' }],
      nextCursor: null,
      hasMore: false,
    }));

    component.nextServerPage();

    expect(component.pageIndex).toBe(1);
    expect(pageRequest).toHaveBeenLastCalledWith({
      cursor: 'user_1',
      limit: 25,
    });

    pageRequest.mockReturnValueOnce(of({
      items: [row],
      nextCursor: 'user_1',
      hasMore: true,
    }));

    component.previousServerPage();

    expect(component.pageIndex).toBe(0);
    expect(pageRequest).toHaveBeenLastCalledWith({
      cursor: null,
      limit: 25,
    });
  });

  it('shows failure instead of an empty success', () => {
    pageRequest.mockReturnValueOnce(
      throwError(() => new Error('permission-denied'))
    );

    component.loadUsers();
    fixture.detectChanges();

    expect(component.loadFailed).toBe(true);
    expect(component.dataSource.data).toHaveLength(0);
    expect(
      TestBed.inject(ErrorNotificationService).showError
    ).toHaveBeenCalled();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });


  it('does not display or search registration data', () => {
    const row = {
      uid: 'private-account',
      nickname: null,
      profileCompleted: true,
      accountStatus: 'active',
      suspended: false,
      accountLocked: false,
      interactionBlocked: false,
      loginAllowed: true,
    };

    pageRequest.mockReturnValueOnce(of({
      items: [row],
      nextCursor: null,
      hasMore: false,
    }));

    component.setOperationalFilter('all');
    component.loadUsers();
    fixture.detectChanges();

    const rendered = String(fixture.nativeElement.textContent);
    const mapped = component.dataSource.data[0];

    expect(mapped.displayName).toBe('Usuario sem apelido');
    expect(rendered).not.toContain('PRIVATE LEGAL NAME');
    expect(rendered).not.toContain(
      'private-registration@example.invalid'
    );
    expect(component.dataSource.filterPredicate(
      mapped, 'private-registration@example.invalid'
    )).toBe(false);
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
