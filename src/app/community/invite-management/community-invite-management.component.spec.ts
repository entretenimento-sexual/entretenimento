import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityInviteRepository } from '../data-access/community-invite.repository';
import { CommunityInviteManagementComponent } from './community-invite-management.component';

describe('CommunityInviteManagementComponent', () => {
  const repositoryMock = {
    getSentInvites$: vi.fn(),
    findCandidate$: vi.fn(),
    sendInvite$: vi.fn(),
    revokeInvite$: vi.fn(),
  };
  const notificationsMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getSentInvites$.mockReturnValue(of({
      items: [],
      generatedAt: 100,
    }));
    repositoryMock.findCandidate$.mockReturnValue(of({
      candidate: {
        userId: 'user-1',
        nickname: 'Pessoa Segura',
        avatarUrl: null,
        status: 'eligible',
      },
      generatedAt: 100,
    }));
    repositoryMock.sendInvite$.mockReturnValue(of({
      inviteId: 'community:community-1:to:user-1',
      communityId: 'community-1',
      receiverId: 'user-1',
      status: 'pending',
      deduplicated: false,
    }));
    repositoryMock.revokeInvite$.mockReturnValue(of({
      inviteId: 'community:community-1:to:user-1',
      communityId: 'community-1',
      receiverId: 'user-1',
      status: 'revoked',
      deduplicated: false,
    }));

    TestBed.configureTestingModule({
      imports: [CommunityInviteManagementComponent],
      providers: [
        { provide: CommunityInviteRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: notificationsMock },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });
  });

  function createFixture() {
    const fixture = TestBed.createComponent(
      CommunityInviteManagementComponent
    );
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('carrega estado vazio sem inventar convites pendentes', () => {
    const fixture = createFixture();

    expect(repositoryMock.getSentInvites$).toHaveBeenCalledWith('community-1');
    expect(fixture.nativeElement.textContent).toContain(
      'Nenhum convite pendente nesta Comunidade.'
    );
    expect(fixture.nativeElement.querySelector(
      '.community-invite-management__pending ul'
    )).toBeNull();
  });

  it('localiza apelido exato e envia pela callable', () => {
    const fixture = createFixture();
    const changed = vi.fn();
    fixture.componentInstance.invitesChanged.subscribe(changed);
    fixture.componentInstance.nickname.setValue('Pessoa Segura');

    fixture.componentInstance.search();
    fixture.detectChanges();

    expect(repositoryMock.findCandidate$).toHaveBeenCalledWith(
      'community-1',
      'Pessoa Segura'
    );
    expect(fixture.nativeElement.textContent).toContain('Perfil disponível');

    const sendButton = fixture.nativeElement.querySelector(
      '.community-invite-candidate > button'
    ) as HTMLButtonElement;
    sendButton.click();
    fixture.detectChanges();

    expect(repositoryMock.sendInvite$).toHaveBeenCalledWith(
      'community-1',
      'user-1'
    );
    expect(notificationsMock.showSuccess).toHaveBeenCalledWith(
      'Convite enviado para Pessoa Segura.'
    );
    expect(changed).toHaveBeenCalledOnce();
  });

  it('revoga convite pendente e atualiza a listagem', () => {
    repositoryMock.getSentInvites$.mockReturnValue(of({
      items: [{
        inviteId: 'community:community-1:to:user-1',
        receiverId: 'user-1',
        receiverLabel: 'Pessoa Segura',
        receiverAvatarUrl: null,
        senderId: 'owner-1',
        senderLabel: 'Você',
        sentAt: 90,
        expiresAt: 200,
      }],
      generatedAt: 100,
    }));
    const fixture = createFixture();
    const revokeButton = fixture.nativeElement.querySelector(
      '.community-invite-management__pending li > button'
    ) as HTMLButtonElement;
    revokeButton.click();
    fixture.detectChanges();

    expect(repositoryMock.revokeInvite$).toHaveBeenCalledWith(
      'community:community-1:to:user-1'
    );
    expect(notificationsMock.showSuccess).toHaveBeenCalledWith(
      'Convite para Pessoa Segura revogado.'
    );
    expect(repositoryMock.getSentInvites$).toHaveBeenCalledTimes(2);
  });

  it('rejeita busca curta antes de chamar o backend', () => {
    const fixture = createFixture();
    fixture.componentInstance.nickname.setValue('ab');
    fixture.componentInstance.search();

    expect(repositoryMock.findCandidate$).not.toHaveBeenCalled();
    expect(notificationsMock.showWarning).toHaveBeenCalledWith(
      'Informe o apelido exato com pelo menos 3 caracteres.'
    );
  });
});
