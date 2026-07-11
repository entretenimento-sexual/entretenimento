// src/app/admin-dashboard/user-list/user-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserListComponent } from './user-list.component';
import { UserManagementService } from '../../core/services/account-moderation/user-management.service';
import { UserModerationService } from '../../core/services/account-moderation/user-moderation.service';
import { AccountLifecycleService } from '../../account/application/account-lifecycle.service';

describe('UserListComponent', () => {
  let component: UserListComponent;
  let fixture: ComponentFixture<UserListComponent>;

  beforeEach(async () => {
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
            moderateScheduleDeletion$: vi.fn(() =>
              of({ ok: true, accountStatus: 'pending_deletion' })
            ),
          },
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: vi.fn(),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(() => ({ afterClosed: () => of(false) })),
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
