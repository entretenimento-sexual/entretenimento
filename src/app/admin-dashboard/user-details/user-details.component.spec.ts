// src/app/admin-dashboard/user-details/user-details.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountLifecycleService } from '../../account/application/account-lifecycle.service';
import { StaffComplianceService } from '../../core/services/compliance/staff-compliance.service';
import { UserDetailsComponent } from './user-details.component';

describe('UserDetailsComponent', () => {
  let fixture: ComponentFixture<UserDetailsComponent>;
  let component: UserDetailsComponent;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let scheduleDeletion: ReturnType<typeof vi.fn>;
  let snackOpen: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(false) }));
    scheduleDeletion = vi.fn(() =>
      of({ ok: true, accountStatus: 'pending_deletion' })
    );
    snackOpen = vi.fn();

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
                  photoURL: null,
                  role: 'free',
                  lastLogin: 0,
                  isSubscriber: false,
                  descricao: '',
                },
              },
            },
          },
        },
        {
          provide: AccountLifecycleService,
          useValue: {
            moderateSuspendAccount$: vi.fn(() =>
              of({ ok: true, accountStatus: 'moderation_suspended' })
            ),
            moderateUnsuspendAccount$: vi.fn(() =>
              of({ ok: true, accountStatus: 'active' })
            ),
            moderateScheduleDeletion$: scheduleDeletion,
          },
        },
        {
          provide: StaffComplianceService,
          useValue: {
            issueSuspectedViolationNotice$: vi.fn(() =>
              of({
                ok: true,
                caseId: 'case-1234567890',
                status: 'AWAITING_USER_RESPONSE',
                responseDueAt: Date.now() + 86_400_000,
              })
            ),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: dialogOpen,
          },
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: snackOpen,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserDetailsComponent);
    component = fixture.componentInstance;
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('deve agendar exclusão pelo lifecycle autorizado', () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteUser();

    expect(scheduleDeletion).toHaveBeenCalledWith(
      'u1',
      'Exclusão agendada pela tela administrativa de detalhes.'
    );
    expect(component.user.accountStatus).toBe('pending_deletion');
    expect(snackOpen).toHaveBeenCalledWith('Exclusão agendada', 'Fechar', {
      duration: 3000,
    });
  });
});
