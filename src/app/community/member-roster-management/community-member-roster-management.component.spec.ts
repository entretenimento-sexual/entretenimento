import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityManagedMemberItem } from '../data-access/community-member-management.model';
import { CommunityMemberManagementRepository } from '../data-access/community-member-management.repository';
import { CommunityMemberRosterManagementComponent } from './community-member-roster-management.component';

function member(
  overrides: Partial<CommunityManagedMemberItem> = {}
): CommunityManagedMemberItem {
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
    ...overrides,
  };
}

describe('CommunityMemberRosterManagementComponent', () => {
  const getManagedMembersPage$ = vi.fn();
  const manageMember$ = vi.fn();
  const showSuccess = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getManagedMembersPage$.mockReturnValue(
      of({ items: [member()], nextCursor: null, generatedAt: 100 })
    );
    manageMember$.mockReturnValue(
      of({ memberId: 'member-1', status: 'active', role: 'member', generatedAt: 200 })
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
          useValue: { showSuccess, showError },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError },
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

  it('carrega ativos paginados pelo repository Observable', () => {
    const fixture = createFixture();

    expect(getManagedMembersPage$).toHaveBeenCalledWith({
      communityId: 'community-1',
      status: 'active',
      cursor: null,
      limit: 20,
    });
    expect(fixture.nativeElement.textContent).toContain('Pessoa Um');
  });

  it('renderiza somente os papéis atribuíveis devolvidos pelo backend', () => {
    const fixture = createFixture();
    const options = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.community-member-roster__role-control option'
      )
    ).map((option) => (option as HTMLOptionElement).value);

    expect(options).toEqual(['admin', 'moderator', 'member']);

    getManagedMembersPage$.mockReturnValue(
      of({
        items: [
          member({
            capabilities: {
              assignableRoles: ['moderator', 'member'],
              canRemove: true,
              canBlock: true,
              canUnblock: false,
            },
          }),
        ],
        nextCursor: null,
        generatedAt: 100,
      })
    );

    const restrictedFixture = createFixture();
    const restrictedOptions = Array.from(
      restrictedFixture.nativeElement.querySelectorAll(
        '.community-member-roster__role-control option'
      )
    ).map((option) => (option as HTMLOptionElement).value);

    expect(restrictedOptions).toEqual(['moderator', 'member']);
  });

  it('não inventa controles quando capabilities são negadas', () => {
    getManagedMembersPage$.mockReturnValue(
      of({
        items: [
          member({
            memberId: 'admin-2',
            label: 'Outro Admin',
            role: 'admin',
            capabilities: {
              assignableRoles: [],
              canRemove: false,
              canBlock: false,
              canUnblock: false,
            },
          }),
        ],
        nextCursor: null,
        generatedAt: 100,
      })
    );

    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain('Outro Admin');
    expect(
      fixture.nativeElement.querySelector('.community-member-roster__role-control')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.community-member-roster__actions')
    ).toBeNull();
  });

  it('pode oferecer remover e bloquear sem oferecer mudança de papel', () => {
    getManagedMembersPage$.mockReturnValue(
      of({
        items: [
          member({
            capabilities: {
              assignableRoles: [],
              canRemove: true,
              canBlock: true,
              canUnblock: false,
            },
          }),
        ],
        nextCursor: null,
        generatedAt: 100,
      })
    );

    const fixture = createFixture();

    expect(
      fixture.nativeElement.querySelector('.community-member-roster__role-control')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.community-member-roster__actions .is-remove')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.community-member-roster__actions .is-block')
    ).not.toBeNull();
  });

  it('exige confirmação antes de bloquear e só então chama a callable', () => {
    const fixture = createFixture();
    const block = fixture.nativeElement.querySelector(
      '.community-member-roster__actions .is-block'
    ) as HTMLButtonElement;

    block.click();
    fixture.detectChanges();

    expect(manageMember$).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Bloquear Pessoa Um?');

    const confirm = fixture.nativeElement.querySelector(
      '.community-member-roster__confirmation .is-confirm'
    ) as HTMLButtonElement;
    confirm.click();
    fixture.detectChanges();

    expect(manageMember$).toHaveBeenCalledWith(
      'community-1',
      'member-1',
      'block',
      null
    );
    expect(showSuccess).toHaveBeenCalledWith(
      'Pessoa Um foi bloqueado na Comunidade.'
    );
  });

  it('lista bloqueados, informa papel anterior e só mostra desbloqueio autorizado', () => {
    getManagedMembersPage$.mockImplementation((request: { status: string }) =>
      of({
        items: request.status === 'blocked'
          ? [
              member({
                status: 'blocked',
                role: 'member',
                roleBeforeBlock: 'moderator',
                capabilities: {
                  assignableRoles: [],
                  canRemove: false,
                  canBlock: false,
                  canUnblock: true,
                },
              }),
            ]
          : [member()],
        nextCursor: null,
        generatedAt: 100,
      })
    );
    manageMember$.mockReturnValue(
      of({ memberId: 'member-1', status: 'left', role: 'member', generatedAt: 200 })
    );

    const fixture = createFixture();
    const blockedTab = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.community-member-roster__status-tabs button'
      )
    ).find((button) => (button as HTMLButtonElement).textContent?.includes('Bloqueados')) as
      | HTMLButtonElement
      | undefined;

    blockedTab?.click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(getManagedMembersPage$).toHaveBeenLastCalledWith({
      communityId: 'community-1',
      status: 'blocked',
      cursor: null,
      limit: 20,
    });
    expect(fixture.nativeElement.textContent).toContain(
      'Antes do bloqueio: Moderação'
    );

    const unblock = fixture.nativeElement.querySelector(
      '.community-member-roster__unblock'
    ) as HTMLButtonElement;
    unblock.click();
    fixture.detectChanges();

    expect(manageMember$).toHaveBeenCalledWith(
      'community-1',
      'member-1',
      'unblock',
      null
    );
    expect(showSuccess).toHaveBeenCalledWith(
      'Pessoa Um foi desbloqueado. Uma nova entrada será necessária.'
    );
  });

  it('mantém bloqueio sem controle quando backend não autoriza desbloqueio', () => {
    getManagedMembersPage$.mockReturnValue(
      of({
        items: [
          member({
            status: 'blocked',
            role: 'member',
            roleBeforeBlock: 'admin',
            capabilities: {
              assignableRoles: [],
              canRemove: false,
              canBlock: false,
              canUnblock: false,
            },
          }),
        ],
        nextCursor: null,
        generatedAt: 100,
      })
    );

    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain(
      'Antes do bloqueio: Administração'
    );
    expect(
      fixture.nativeElement.querySelector('.community-member-roster__unblock')
    ).toBeNull();
  });

  it('mantém falha de carregamento inline sem snackbar duplicado', () => {
    getManagedMembersPage$.mockReturnValue(
      throwError(() => ({
        code: 'functions/failed-precondition',
        details: { reason: 'community_not_manageable' },
      }))
    );

    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain('Participantes indisponíveis.');
    expect(showError).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledTimes(1);
  });

  it('traduz reason estruturado em ação administrativa sem expor mensagem técnica', () => {
    manageMember$.mockReturnValue(
      throwError(() => ({
        code: 'functions/failed-precondition',
        message: 'internal detail',
        details: { reason: 'recent-authentication-required' },
      }))
    );
    const fixture = createFixture();
    const block = fixture.nativeElement.querySelector(
      '.community-member-roster__actions .is-block'
    ) as HTMLButtonElement;

    block.click();
    fixture.detectChanges();
    const confirm = fixture.nativeElement.querySelector(
      '.community-member-roster__confirmation .is-confirm'
    ) as HTMLButtonElement;
    confirm.click();
    fixture.detectChanges();

    expect(showError).toHaveBeenCalledWith(
      'Por segurança, saia e entre novamente antes de confirmar esta ação administrativa.'
    );
    expect(showError.mock.calls[0]?.[0]).not.toContain('internal detail');
    expect(handleError).toHaveBeenCalledTimes(1);
  });
});