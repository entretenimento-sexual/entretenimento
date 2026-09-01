import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityMemberManagementRepository } from '../data-access/community-member-management.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewViewerRole } from '../data-access/community-preview.model';
import { CommunitySettingsRepository } from '../data-access/community-settings.repository';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import {
  CommunityManagementPanel,
  CommunityMembershipManagementComponent,
} from './community-membership-management.component';

describe('CommunityMembershipManagementComponent', () => {
  const repositoryMock = {
    getMembershipRequests$: vi.fn(),
    reviewMembership$: vi.fn(),
  };
  const memberManagementRepositoryMock = {
    getManagedMembersPage$: vi.fn(),
    manageMember$: vi.fn(),
  };
  const settingsRepositoryMock = { updateSettings$: vi.fn() };
  const tagRepositoryMock = { getCommunityTagCatalog$: vi.fn() };
  const errorNotifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };
  const handleError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getMembershipRequests$.mockReturnValue(
      of({ items: [], generatedAt: 100 })
    );
    repositoryMock.reviewMembership$.mockReturnValue(
      of({ memberId: 'member-1', status: 'active', viewerMode: 'member' })
    );
    memberManagementRepositoryMock.getManagedMembersPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 100 })
    );
    memberManagementRepositoryMock.manageMember$.mockReturnValue(
      of({ memberId: 'member-1', status: 'active', role: 'member', generatedAt: 100 })
    );
    settingsRepositoryMock.updateSettings$.mockReturnValue(of({
      communityId: 'community-1',
      updated: true,
      changedFields: [],
      generatedAt: 100,
    }));
    tagRepositoryMock.getCommunityTagCatalog$.mockReturnValue(of({
      items: [
        { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
      ],
      generatedAt: 100,
    }));

    TestBed.configureTestingModule({
      imports: [CommunityMembershipManagementComponent],
      providers: [
        { provide: CommunityMembershipRepository, useValue: repositoryMock },
        {
          provide: CommunityMemberManagementRepository,
          useValue: memberManagementRepositoryMock,
        },
        { provide: CommunitySettingsRepository, useValue: settingsRepositoryMock },
        { provide: CommunityTagRepository, useValue: tagRepositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: { handleError } },
      ],
    });
  });

  function createFixture(
    sourceType: 'community' | 'venue' = 'community',
    viewerRole: CommunityPreviewViewerRole | null = null
  ) {
    const fixture = TestBed.createComponent(
      CommunityMembershipManagementComponent
    );
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('sourceType', sourceType);
    fixture.componentRef.setInput('viewerRole', viewerRole);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  function selectPanel(
    fixture: ReturnType<typeof createFixture>,
    panel: CommunityManagementPanel
  ): void {
    fixture.componentInstance.selectPanel(panel);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function seedPendingRequest(): void {
    repositoryMock.getMembershipRequests$.mockReturnValue(
      of({
        items: [
          {
            memberId: 'member-1',
            label: 'Pessoa Um',
            avatarUrl: null,
            requestedAt: 100,
          },
        ],
        generatedAt: 200,
      })
    );
  }

  it('abre em visão geral sem empilhar as ferramentas pesadas de gestão', () => {
    const fixture = createFixture('community', 'moderator');

    expect(fixture.componentInstance.activePanel()).toBe('overview');
    expect(fixture.nativeElement.textContent).toContain('Gestão da Comunidade');
    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma solicitação de entrada pendente.'
    );
    expect(
      fixture.nativeElement.querySelector('app-community-member-roster-management')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('app-community-settings')
    ).toBeNull();
    expect(memberManagementRepositoryMock.getManagedMembersPage$).not.toHaveBeenCalled();
  });

  it('usa solicitações de acesso no contexto de Local', () => {
    const fixture = createFixture('venue');
    selectPanel(fixture, 'requests');

    expect(fixture.nativeElement.textContent).toContain(
      'Solicitações de acesso'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma solicitação de acesso pendente.'
    );
  });

  it('carrega Participantes somente quando o moderador abre a área', () => {
    const fixture = createFixture('community', 'moderator');

    expect(memberManagementRepositoryMock.getManagedMembersPage$).not.toHaveBeenCalled();
    selectPanel(fixture, 'members');

    expect(
      fixture.nativeElement.querySelector('app-community-member-roster-management')
    ).not.toBeNull();
    expect(memberManagementRepositoryMock.getManagedMembersPage$).toHaveBeenCalledWith({
      communityId: 'community-1',
      status: 'active',
      cursor: null,
      limit: 20,
    });
  });

  it('não mistura gestão de papéis de Comunidade com Local', () => {
    const fixture = createFixture('venue', 'moderator');
    selectPanel(fixture, 'members');

    expect(fixture.componentInstance.activePanel()).toBe('overview');
    expect(
      fixture.nativeElement.querySelector('app-community-member-roster-management')
    ).toBeNull();
    expect(memberManagementRepositoryMock.getManagedMembersPage$).not.toHaveBeenCalled();
  });

  it('carrega configurações somente após capability e seleção explícita', () => {
    const fixture = createFixture('community', 'admin');
    fixture.componentRef.setInput('canManageCommunitySettings', true);
    fixture.componentRef.setInput('settings', {
      name: 'Comunidade Segura',
      description: null,
      rules: 'Respeite todos os participantes.',
      joinPolicy: 'approval',
      membersCanInvite: false,
      memberLimit: 25,
      tagIds: ['intent:friendship'],
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('app-community-settings')
    ).toBeNull();

    selectPanel(fixture, 'settings');

    expect(
      fixture.nativeElement.querySelector('app-community-settings')
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Dados e acesso');
  });

  it('expõe atalhos de convite e moderação sem duplicar os fluxos', () => {
    const fixture = createFixture('community', 'admin');
    const inviteRequested = vi.fn();
    const feedRequested = vi.fn();
    fixture.componentRef.setInput('canInviteCommunityMembers', true);
    fixture.componentInstance.inviteRequested.subscribe(inviteRequested);
    fixture.componentInstance.feedRequested.subscribe(feedRequested);
    fixture.detectChanges();

    fixture.componentInstance.openInvites();
    fixture.componentInstance.openModeration();

    expect(inviteRequested).toHaveBeenCalledTimes(1);
    expect(feedRequested).toHaveBeenCalledTimes(1);
  });

  it('aprova pela callable, informa sucesso e atualiza a fila', () => {
    seedPendingRequest();

    const fixture = createFixture();
    selectPanel(fixture, 'requests');
    const action = fixture.nativeElement.querySelector(
      '.community-membership-management__actions .is-approve'
    ) as HTMLButtonElement;

    expect(fixture.nativeElement.textContent).toContain('Pessoa Um');
    action.click();
    fixture.detectChanges();

    expect(repositoryMock.reviewMembership$).toHaveBeenCalledWith(
      'community-1',
      'member-1',
      'approve'
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Pessoa Um entrou na Comunidade.'
    );
    expect(repositoryMock.getMembershipRequests$).toHaveBeenCalledTimes(2);
  });

  it('aprova acesso de Local sem chamar a pessoa de membro de Comunidade', () => {
    seedPendingRequest();

    const fixture = createFixture('venue');
    selectPanel(fixture, 'requests');
    const action = fixture.nativeElement.querySelector(
      '.community-membership-management__actions .is-approve'
    ) as HTMLButtonElement;
    action.click();
    fixture.detectChanges();

    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Pessoa Um recebeu acesso ao Local.'
    );
  });

  it('recusa sem alterar a nomenclatura pública do repositório', () => {
    seedPendingRequest();

    const fixture = createFixture();
    selectPanel(fixture, 'requests');
    const action = fixture.nativeElement.querySelector(
      '.community-membership-management__actions .is-reject'
    ) as HTMLButtonElement;
    action.click();
    fixture.detectChanges();

    expect(repositoryMock.reviewMembership$).toHaveBeenCalledWith(
      'community-1',
      'member-1',
      'reject'
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Solicitação de Pessoa Um recusada.'
    );
  });

  it('mantém indisponibilidade da fila inline sem snackbar duplicado', () => {
    repositoryMock.getMembershipRequests$.mockReturnValue(
      throwError(() => ({
        code: 'functions/failed-precondition',
        details: { reason: 'community_not_manageable' },
      }))
    );

    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain(
      'Fila temporariamente indisponível.'
    );
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledTimes(1);

    selectPanel(fixture, 'requests');
    expect(fixture.nativeElement.textContent).toContain('Fila indisponível.');
  });

  it('traduz request_not_pending sem expor mensagem técnica do backend', () => {
    seedPendingRequest();
    repositoryMock.reviewMembership$.mockReturnValue(
      throwError(() => ({
        code: 'functions/failed-precondition',
        message: 'internal state detail',
        details: { reason: 'request_not_pending' },
      }))
    );

    const fixture = createFixture();
    selectPanel(fixture, 'requests');
    const action = fixture.nativeElement.querySelector(
      '.community-membership-management__actions .is-approve'
    ) as HTMLButtonElement;
    action.click();
    fixture.detectChanges();

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Esta solicitação já foi processada ou não está mais pendente.'
    );
    expect(errorNotifierMock.showError.mock.calls[0]?.[0]).not.toContain(
      'internal state detail'
    );
    expect(handleError).toHaveBeenCalledTimes(1);
  });

  it('usa mensagem contextual quando a revisão é limitada por antiabuso', () => {
    seedPendingRequest();
    repositoryMock.reviewMembership$.mockReturnValue(
      throwError(() => ({
        code: 'functions/resource-exhausted',
        details: {
          reason: 'community_management_rate_limited',
          recommendedAction: 'retry_later',
        },
      }))
    );

    const fixture = createFixture();
    selectPanel(fixture, 'requests');
    const action = fixture.nativeElement.querySelector(
      '.community-membership-management__actions .is-approve'
    ) as HTMLButtonElement;
    action.click();
    fixture.detectChanges();

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Muitas ações de gestão foram executadas em pouco tempo. Aguarde e tente novamente.'
    );
    expect(handleError).toHaveBeenCalledTimes(1);
  });
});
