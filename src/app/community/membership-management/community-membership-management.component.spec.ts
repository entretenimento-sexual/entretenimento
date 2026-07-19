import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityMembershipManagementComponent } from './community-membership-management.component';

describe('CommunityMembershipManagementComponent', () => {
  const repositoryMock = {
    getMembershipRequests$: vi.fn(),
    reviewMembership$: vi.fn(),
  };
  const errorNotifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getMembershipRequests$.mockReturnValue(
      of({ items: [], generatedAt: 100 })
    );
    repositoryMock.reviewMembership$.mockReturnValue(
      of({ memberId: 'member-1', status: 'active', viewerMode: 'member' })
    );

    TestBed.configureTestingModule({
      imports: [CommunityMembershipManagementComponent],
      providers: [
        { provide: CommunityMembershipRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
  });

  function createFixture(sourceType: 'community' | 'venue' = 'community') {
    const fixture = TestBed.createComponent(
      CommunityMembershipManagementComponent
    );
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('sourceType', sourceType);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('mostra estado vazio de Comunidade sem expor uma lista falsa', () => {
    const fixture = createFixture();

    expect(repositoryMock.getMembershipRequests$).toHaveBeenCalledWith(
      'community-1'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma solicitação de entrada pendente.'
    );
    expect(fixture.nativeElement.querySelector('ul')).toBeNull();
  });

  it('usa solicitações de acesso no contexto de Local', () => {
    const fixture = createFixture('venue');

    expect(fixture.nativeElement.textContent).toContain(
      'Solicitações de acesso'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma solicitação de acesso pendente.'
    );
  });

  it('aprova pela callable, informa sucesso e atualiza a fila', () => {
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

    const fixture = createFixture();
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

    const fixture = createFixture('venue');
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

    const fixture = createFixture();
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
});
