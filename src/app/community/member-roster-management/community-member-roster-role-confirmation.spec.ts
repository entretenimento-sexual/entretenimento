import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityManagedMemberItem } from '../data-access/community-member-management.model';
import { CommunityMemberManagementRepository } from '../data-access/community-member-management.repository';
import { CommunityMemberRosterManagementComponent } from './community-member-roster-management.component';

function member(): CommunityManagedMemberItem {
  return {
    memberId: 'member-1',
    label: 'Pessoa Um',
    avatarUrl: null,
    status: 'active',
    role: 'member',
    roleBeforeBlock: null,
    updatedAt: 100,
    capabilities: {
      assignableRoles: ['admin', 'moderator', 'member'],
      canRemove: true,
      canBlock: true,
      canUnblock: false,
    },
  };
}

describe('CommunityMemberRosterManagementComponent role confirmation', () => {
  const getManagedMembersPage$ = vi.fn();
  const manageMember$ = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getManagedMembersPage$.mockReturnValue(
      of({ items: [member()], nextCursor: null, generatedAt: 100 })
    );
    manageMember$.mockReturnValue(
      of({ memberId: 'member-1', status: 'active', role: 'admin', generatedAt: 200 })
    );

    TestBed.configureTestingModule({
      imports: [CommunityMemberRosterManagementComponent],
      providers: [
        {
          provide: CommunityMemberManagementRepository,
          useValue: { getManagedMembersPage$, manageMember$ },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showSuccess: vi.fn(), showError: vi.fn() },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });
  });

  function createFixture() {
    const fixture = TestBed.createComponent(CommunityMemberRosterManagementComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  function chooseAdmin(fixture: ReturnType<typeof createFixture>): HTMLSelectElement {
    const select = fixture.nativeElement.querySelector(
      '.community-member-roster__role-control select'
    ) as HTMLSelectElement;

    select.value = 'admin';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    return select;
  }

  it('não altera o papel ao selecionar e exige confirmação explícita', () => {
    const fixture = createFixture();
    const select = chooseAdmin(fixture);

    expect(manageMember$).not.toHaveBeenCalled();
    expect(select.value).toBe('member');
    expect(fixture.nativeElement.textContent).toContain('Alterar papel de Pessoa Um?');
    expect(fixture.nativeElement.textContent).toContain(
      'Pessoa Um passará a ter poderes administrativos nesta Comunidade.'
    );

    const confirm = fixture.nativeElement.querySelector(
      '.community-member-roster__confirmation .is-role-confirm'
    ) as HTMLButtonElement;
    confirm.click();
    fixture.detectChanges();

    expect(manageMember$).toHaveBeenCalledTimes(1);
    expect(manageMember$).toHaveBeenCalledWith(
      'community-1',
      'member-1',
      'set_role',
      'admin'
    );
  });

  it('cancelar a confirmação preserva o papel e não chama a callable', () => {
    const fixture = createFixture();
    chooseAdmin(fixture);

    const cancel = fixture.nativeElement.querySelector(
      '.community-member-roster__confirmation .is-cancel'
    ) as HTMLButtonElement;
    cancel.click();
    fixture.detectChanges();

    expect(manageMember$).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('.community-member-roster__confirmation')
    ).toBeNull();
  });
});
