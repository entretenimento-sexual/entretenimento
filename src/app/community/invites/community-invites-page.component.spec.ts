// src/app/community/invites/community-invites-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { filter, firstValueFrom, of, Subject, take, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityInviteRepository } from '../data-access/community-invite.repository';
import { CommunityInvitesPageComponent } from './community-invites-page.component';

function inviteItem() {
  return {
    inviteId: 'community:community-casais-sp:to:user-1',
    communityId: 'community-casais-sp',
    communityName: 'Casais SP',
    senderId: 'sender-1',
    senderLabel: 'Perfil convidante',
    senderAvatarUrl: null,
    sentAt: 1_787_000_000_000,
    expiresAt: 1_787_604_800_000,
  };
}

describe('CommunityInvitesPageComponent', () => {
  const getInvites$ = vi.fn();
  const acceptInvite$ = vi.fn();
  const declineInvite$ = vi.fn();
  const showSuccess = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getInvites$.mockReturnValue(
      of({ items: [inviteItem()], generatedAt: 1_787_000_000_000 })
    );
    acceptInvite$.mockReturnValue(
      of({
        inviteId: inviteItem().inviteId,
        communityId: inviteItem().communityId,
        receiverId: 'user-1',
        status: 'accepted',
        deduplicated: false,
      })
    );
    declineInvite$.mockReturnValue(
      of({
        inviteId: inviteItem().inviteId,
        communityId: inviteItem().communityId,
        receiverId: 'user-1',
        status: 'declined',
        deduplicated: false,
      })
    );

    TestBed.configureTestingModule({
      imports: [CommunityInvitesPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: CommunityInviteRepository,
          useValue: { getInvites$, acceptInvite$, declineInvite$ },
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

  it('carrega somente o inbox sanitizado devolvido pela Function', async () => {
    const component = TestBed.runInInjectionContext(
      () => new CommunityInvitesPageComponent()
    );
    const state = await firstValueFrom(
      component.state$.pipe(
        filter((value) => value.status === 'ready'),
        take(1)
      )
    );

    expect(getInvites$).toHaveBeenCalledTimes(1);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.communityName).toBe('Casais SP');
  });

  it('mantém falha de carga na própria página sem toast redundante', async () => {
    getInvites$.mockReturnValue(throwError(
      () => Object.assign(new Error('load failed'), {
        code: 'functions/unavailable',
      })
    ));

    const component = TestBed.runInInjectionContext(
      () => new CommunityInvitesPageComponent()
    );
    const state = await firstValueFrom(
      component.state$.pipe(
        filter((value) => value.status === 'error'),
        take(1)
      )
    );

    expect(state.items).toEqual([]);
    expect(showError).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('mostra o contexto do convite sem repetir eyebrow em cada card', () => {
    const fixture = TestBed.createComponent(CommunityInvitesPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '.community-invite-card'
    ) as HTMLElement | null;

    expect(card?.textContent).toContain('Casais SP');
    expect(card?.textContent).toContain('Perfil convidante');
    expect(card?.textContent).not.toContain('Convite de Comunidade');
    expect(
      fixture.nativeElement.querySelector('.community-invite-card__eyebrow')
    ).toBeNull();
  });

  it('aceita o convite, informa o usuário e abre a Comunidade', () => {
    const fixture = TestBed.createComponent(CommunityInvitesPageComponent);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const item = inviteItem();

    fixture.componentInstance.accept(item);

    expect(acceptInvite$).toHaveBeenCalledWith(item.inviteId);
    expect(showSuccess).toHaveBeenCalledWith('Você entrou em Casais SP.');
    expect(navigate).toHaveBeenCalledWith([
      '/dashboard/comunidades',
      item.communityId,
    ]);
    expect(fixture.componentInstance.isBusy(item.inviteId)).toBe(false);
  });

  it('mostra progresso apenas no botão Aceitar durante a aceitação', () => {
    const pendingAccept$ = new Subject<{
      inviteId: string;
      communityId: string;
      receiverId: string;
      status: 'accepted';
      deduplicated: boolean;
    }>();
    acceptInvite$.mockReturnValue(pendingAccept$);

    const fixture = TestBed.createComponent(CommunityInvitesPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    const item = inviteItem();
    const accept = fixture.nativeElement.querySelector(
      '.community-invite-card__accept'
    ) as HTMLButtonElement;
    const decline = fixture.nativeElement.querySelector(
      '.community-invite-card__decline'
    ) as HTMLButtonElement;

    accept.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.busyAction(item.inviteId)).toBe('accept');
    expect(accept.disabled).toBe(true);
    expect(decline.disabled).toBe(true);
    expect(accept.textContent).toContain('Aceitando');
    expect(decline.textContent).toContain('Recusar');
    expect(decline.textContent).not.toContain('Recusando');
    expect(accept.getAttribute('aria-busy')).toBe('true');
    expect(decline.getAttribute('aria-busy')).toBeNull();
  });

  it('recusa o convite e recarrega o inbox sem navegação adicional', () => {
    const fixture = TestBed.createComponent(CommunityInvitesPageComponent);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const item = inviteItem();

    fixture.componentInstance.decline(item);

    expect(declineInvite$).toHaveBeenCalledWith(item.inviteId);
    expect(showSuccess).toHaveBeenCalledWith('Convite recusado.');
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.isBusy(item.inviteId)).toBe(false);
  });

  it('mostra progresso apenas no botão Recusar durante a recusa', () => {
    const pendingDecline$ = new Subject<{
      inviteId: string;
      communityId: string;
      receiverId: string;
      status: 'declined';
      deduplicated: boolean;
    }>();
    declineInvite$.mockReturnValue(pendingDecline$);

    const fixture = TestBed.createComponent(CommunityInvitesPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    const item = inviteItem();
    const accept = fixture.nativeElement.querySelector(
      '.community-invite-card__accept'
    ) as HTMLButtonElement;
    const decline = fixture.nativeElement.querySelector(
      '.community-invite-card__decline'
    ) as HTMLButtonElement;

    decline.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.busyAction(item.inviteId)).toBe('decline');
    expect(accept.disabled).toBe(true);
    expect(decline.disabled).toBe(true);
    expect(decline.textContent).toContain('Recusando');
    expect(accept.textContent).toContain('Aceitar');
    expect(accept.textContent).not.toContain('Aceitando');
    expect(decline.getAttribute('aria-busy')).toBe('true');
    expect(accept.getAttribute('aria-busy')).toBeNull();
  });
});