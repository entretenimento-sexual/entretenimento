// src/app/admin-dashboard/user-details/user-details.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserDetailsComponent } from './user-details.component';
import { UserManagementService } from '../../core/services/account-moderation/user-management.service';
import { UserModerationService } from '../../core/services/account-moderation/user-moderation.service';

describe('UserDetailsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserDetailsComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: {
                user: {
                  uid: 'u1',
                  email: 'admin-target@example.com',
                  nickname: 'Target',
                },
              },
            },
          },
        },
        {
          provide: UserManagementService,
          useValue: {
            deleteUserAccount: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: UserModerationService,
          useValue: {
            suspendUser: vi.fn(() => of(void 0)),
            unsuspendUser: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(() => ({ afterClosed: () => of(false) })),
          },
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(UserDetailsComponent);
    const comp = fixture.componentInstance;
    expect(comp).toBeTruthy();
  });
});
