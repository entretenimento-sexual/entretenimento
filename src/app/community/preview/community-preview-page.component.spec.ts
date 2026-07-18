import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityPreviewPageComponent } from './community-preview-page.component';

function preview(
  overrides: Partial<ReturnType<typeof basePreview>> = {}
) {
  const base = basePreview();
  return {
    ...base,
    ...overrides,
    community: {
      ...base.community,
      ...(overrides.community ?? {}),
      access: {
        ...base.community.access,
        ...(overrides.community?.access ?? {}),
      },
    },
  };
}

function basePreview() {
  return {
    community: {
      communityId: 'community-1',
      name: 'Comunidade do Centro',
      slug: 'comunidade-do-centro',
      description: 'Atualizações e fotos do local.',
      source: { type: 'venue' as const, id: 'venue-1' },
      avatarUrl: null,
      coverUrl: null,
      metrics: { memberCount: 12, postCount: 4, mediaCount: 3 },
      access: {
        join: 'approval' as 'open' | 'approval' | 'invite_only',
        minimumRole: null as 'basic' | 'premium' | 'vip' | null,
        requiresActiveSubscription: false,
      },
    },
    viewerMode: 'visitor' as 'visitor' | 'pending' | 'member' | 'moderator' | 'manager',
    canInteract: false,
    generatedAt: 123,
  };
}

describe('CommunityPreviewPageComponent', () => {
  const previewRepositoryMock = { getPreview$: vi.fn() };
  const feedRepositoryMock = { getPage$: vi.fn() };
  const membershipRepositoryMock = {
    requestMembership$: vi.fn(),
    leaveMembership$: vi.fn(),
    getMembershipRequests$: vi.fn(),
    reviewMembership$: vi.fn(),
  };
  const accessNavigationMock = { navigateForDecision: vi.fn() };
  const errorNotifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    previewRepositoryMock.getPreview$.mockReturnValue(of(preview()));
    feedRepositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );
    membershipRepositoryMock.requestMembership$.mockReturnValue(
      of({ status: 'pending', viewerMode: 'pending', canInteract: false })
    );
    membershipRepositoryMock.leaveMembership$.mockReturnValue(
      of({ status: 'left', viewerMode: 'visitor', canInteract: false })
    );
    membershipRepositoryMock.getMembershipRequests$.mockReturnValue(
      of({ items: [], generatedAt: 123 })
    );
    membershipRepositoryMock.reviewMembership$.mockReturnValue(
      of({ memberId: 'member-1', status: 'active', viewerMode: 'member' })
    );
    accessNavigationMock.navigateForDecision.mockResolvedValue(true);

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ communityId: 'community-1' })),
          },
        },
        { provide: CommunityPreviewRepository, useValue: previewRepositoryMock },
        { provide: CommunityFeedRepository, useValue: feedRepositoryMock },
        { provide: CommunityMembershipRepository, useValue: membershipRepositoryMock },
        { provide: ContentAccessNavigationService, useValue: accessNavigationMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
  });

  function createFixture() {
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  function sectionButton(
    fixture: ReturnType<typeof createFixture>,
    index: number
  ): HTMLButtonElement {
    const button = fixture.nativeElement.querySelectorAll(
      '.community-preview__tabs button'
    ).item(index) as HTMLButtonElement | null;

    if (!button) throw new Error(`Botão comunitário ${index} ausente.`);
    return button;
  }

  it('mantém título único e submenu contextual enxuto', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.querySelectorAll('h1')).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelectorAll('.community-preview__tabs button')
    ).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('Mural');
    expect(fixture.nativeElement.textContent).toContain('Fotos');
    expect(fixture.nativeElement.textContent).toContain('Sobre');
  });

  it('não repete descrição ou rótulo de visitante no cabeçalho', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).not.toContain(
      'Atualizações e fotos do local.'
    );
    expect(fixture.nativeElement.textContent).not.toContain('Visitante');
  });

  it('mostra descrição e métricas somente em Sobre', () => {
    const fixture = createFixture();

    sectionButton(fixture, 2).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Atualizações e fotos do local.'
    );
    expect(fixture.nativeElement.textContent).toContain('12 membros');
    expect(fixture.nativeElement.textContent).toContain(
      'Interação reservada aos membros'
    );
  });

  it('consulta fotos somente após selecionar a galeria', () => {
    const fixture = createFixture();

    expect(feedRepositoryMock.getPage$).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'feed' })
    );

    sectionButton(fixture, 1).click();
    fixture.detectChanges();

    expect(feedRepositoryMock.getPage$).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'photos' })
    );
  });

  it('envia a adesão somente pela callable e recarrega a prévia', () => {
    const fixture = createFixture();
    const action = fixture.nativeElement.querySelector(
      '.community-preview__membership-action'
    ) as HTMLButtonElement;

    expect(action.textContent).toContain('Solicitar');
    action.click();
    fixture.detectChanges();

    expect(membershipRepositoryMock.requestMembership$).toHaveBeenCalledWith(
      'community-1'
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Solicitação enviada.'
    );
    expect(previewRepositoryMock.getPreview$).toHaveBeenCalledTimes(2);
  });

  it('encaminha assinatura insuficiente pelo padrão global de acesso', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(
        preview({
          community: {
            ...basePreview().community,
            access: {
              join: 'open',
              minimumRole: 'premium',
              requiresActiveSubscription: true,
            },
          },
        })
      )
    );
    membershipRepositoryMock.requestMembership$.mockReturnValue(
      throwError(() => ({
        details: {
          reason: 'subscription_inactive',
          recommendedAction: 'upgrade_subscription',
          minimumRole: 'premium',
        },
      }))
    );

    const fixture = createFixture();
    const action = fixture.nativeElement.querySelector(
      '.community-preview__membership-action'
    ) as HTMLButtonElement;
    action.click();
    fixture.detectChanges();

    expect(accessNavigationMock.navigateForDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed: false,
        reason: 'subscription_inactive',
        recommendedAction: 'upgrade_subscription',
        minimumRole: 'premium',
      })
    );
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
  });

  it('mantém estado pendente e permite cancelamento pela callable', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(preview({ viewerMode: 'pending' }))
    );

    const fixture = createFixture();
    const cancel = fixture.nativeElement.querySelector(
      '.community-preview__membership-leave-action'
    ) as HTMLButtonElement;

    expect(
      fixture.nativeElement.querySelector('.community-preview__membership-action')
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Solicitação enviada');
    expect(fixture.nativeElement.textContent).not.toContain('Pendente');

    cancel.click();
    fixture.detectChanges();

    expect(membershipRepositoryMock.leaveMembership$).toHaveBeenCalledWith(
      'community-1'
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Solicitação cancelada.'
    );
  });

  it('permite saída voluntária do membro e retorna ao mural', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(preview({ viewerMode: 'member', canInteract: true }))
    );

    const fixture = createFixture();
    sectionButton(fixture, 2).click();
    fixture.detectChanges();
    const leave = fixture.nativeElement.querySelector(
      '.community-preview__membership-leave-action'
    ) as HTMLButtonElement;
    leave.click();
    fixture.detectChanges();

    expect(membershipRepositoryMock.leaveMembership$).toHaveBeenCalledWith(
      'community-1'
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Você saiu da comunidade.'
    );
    expect(fixture.componentInstance.activeSection()).toBe('feed');
  });

  it('não oferece adesão em comunidade somente por convite', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(
        preview({
          community: {
            ...basePreview().community,
            access: {
              ...basePreview().community.access,
              join: 'invite_only',
            },
          },
        })
      )
    );

    const fixture = createFixture();

    expect(
      fixture.nativeElement.querySelector('.community-preview__membership-action')
    ).toBeNull();
  });

  it('carrega a fila somente quando a moderação abre a aba contextual', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(preview({ viewerMode: 'moderator', canInteract: true }))
    );

    const fixture = createFixture();

    expect(
      fixture.nativeElement.querySelectorAll('.community-preview__tabs button')
    ).toHaveLength(4);
    expect(membershipRepositoryMock.getMembershipRequests$).not.toHaveBeenCalled();

    sectionButton(fixture, 3).click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(membershipRepositoryMock.getMembershipRequests$).toHaveBeenCalledWith(
      'community-1'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma solicitação pendente.'
    );
  });

  it('explica assinatura vencida ao membro sem tratá-lo como visitante', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(
        preview({
          viewerMode: 'member',
          canInteract: false,
          community: {
            ...basePreview().community,
            access: {
              join: 'open',
              minimumRole: 'premium',
              requiresActiveSubscription: true,
            },
          },
        })
      )
    );

    const fixture = createFixture();
    sectionButton(fixture, 2).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Assinatura necessária para interagir'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Interação reservada aos membros'
    );
  });
});
