import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityMemberRosterRepository } from '../data-access/community-member-roster.repository';
import { CommunityMemberSearchRepository } from '../data-access/community-member-search.repository';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewResponse } from '../data-access/community-preview.model';
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

function basePreview(): CommunityPreviewResponse {
  return {
    community: {
      communityId: 'community-1',
      name: 'Local do Centro',
      slug: 'local-do-centro',
      description: 'Atualizações e fotos do Local.',
      source: { type: 'venue', id: 'venue-1' },
      avatarUrl: null,
      coverUrl: null,
      metrics: { memberCount: 12, postCount: 4, mediaCount: 3 },
      access: {
        join: 'approval',
        minimumRole: null,
        requiresActiveSubscription: false,
      },
      tags: [],
      officialAssociation: {
        target: { type: 'venue', id: 'venue-1' },
        verified: true,
      },
    },
    rules: null,
    lifecycleStatus: null,
    viewerMode: 'visitor',
    viewerRole: null,
    canInteract: false,
    canManageMemberships: false,
    canInviteCommunityMembers: false,
    canManageCommunitySettings: false,
    capacity: null,
    capacityRegularization: null,
    settings: null,
    canLeaveMembership: false,
    generatedAt: 123,
  };
}

describe('CommunityPreviewPageComponent / Local', () => {
  const rosterRepositoryMock = { getPage$: vi.fn() };
  const memberSearchRepositoryMock = { searchPage$: vi.fn() };
  const dialogMock = { open: vi.fn() };
  const previewRepositoryMock = {
    getPreview$: vi.fn(),
    getOfficialCommunitiesForTarget$: vi.fn(),
  };
  const feedRepositoryMock = {
    getPage$: vi.fn(),
    getItems$: vi.fn(),
    watchLatestChanges$: vi.fn(),
  };
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
    rosterRepositoryMock.getPage$.mockReturnValue(of({
      items: [], nextCursor: null, memberCount: 12, generatedAt: 123,
    }));
    memberSearchRepositoryMock.searchPage$.mockReturnValue(of({
      items: [], nextCursor: null, memberCount: 12, generatedAt: 123,
    }));
    previewRepositoryMock.getPreview$.mockReturnValue(of(preview()));
    previewRepositoryMock.getOfficialCommunitiesForTarget$.mockReturnValue(of({
      items: [basePreview().community],
      nextCursor: null,
      generatedAt: 123,
    }));
    feedRepositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );
    feedRepositoryMock.getItems$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );
    feedRepositoryMock.watchLatestChanges$.mockReturnValue(of([]));
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
    dialogMock.open.mockReturnValue({ afterClosed: () => of(false) });
    accessNavigationMock.navigateForDecision.mockResolvedValue(true);

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { backRoute: '/dashboard/locais' } },
            paramMap: of(convertToParamMap({ communityId: 'community-1' })),
          },
        },
        { provide: CommunityMemberRosterRepository, useValue: rosterRepositoryMock },
        { provide: CommunityMemberSearchRepository, useValue: memberSearchRepositoryMock },
        { provide: MatDialog, useValue: dialogMock },
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

    if (!button) throw new Error(`Botão do espaço ${index} ausente.`);
    return button;
  }


  it('expõe tabs com semântica ARIA completa e navegação horizontal por teclado', () => {
    const fixture = createFixture();
    const tablist = fixture.nativeElement.querySelector(
      '.community-preview__tablist'
    ) as HTMLElement;
    const tabs = Array.from(
      tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    );

    expect(tablist.getAttribute('role')).toBe('tablist');
    expect(tablist.getAttribute('aria-orientation')).toBe('horizontal');
    expect(tabs).toHaveLength(3);

    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();

      const panel = fixture.nativeElement.querySelector(
        `#${panelId}`
      ) as HTMLElement | null;

      expect(panel).not.toBeNull();
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }

    const feed = fixture.nativeElement.querySelector(
      '#community-tab-feed'
    ) as HTMLButtonElement;
    const photos = fixture.nativeElement.querySelector(
      '#community-tab-photos'
    ) as HTMLButtonElement;
    const about = fixture.nativeElement.querySelector(
      '#community-tab-about'
    ) as HTMLButtonElement;

    expect(feed.getAttribute('aria-selected')).toBe('true');
    expect(feed.tabIndex).toBe(0);
    expect(photos.getAttribute('aria-selected')).toBe('false');
    expect(photos.tabIndex).toBe(-1);
    expect(
      (fixture.nativeElement.querySelector('#community-panel-feed') as HTMLElement).hidden
    ).toBe(false);
    expect(
      (fixture.nativeElement.querySelector('#community-panel-photos') as HTMLElement).hidden
    ).toBe(true);

    feed.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.activeSection()).toBe('photos');
    expect(document.activeElement).toBe(photos);
    expect(photos.getAttribute('aria-selected')).toBe('true');
    expect(photos.tabIndex).toBe(0);

    photos.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'End',
      bubbles: true,
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.activeSection()).toBe('about');
    expect(document.activeElement).toBe(about);

    about.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Home',
      bubbles: true,
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.activeSection()).toBe('feed');
    expect(document.activeElement).toBe(feed);

    feed.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'End',
      bubbles: true,
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.activeSection()).toBe('about');
    expect(document.activeElement).toBe(about);

    about.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.activeSection()).toBe('feed');
    expect(document.activeElement).toBe(feed);

    feed.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      altKey: true,
      bubbles: true,
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.activeSection()).toBe('feed');
    expect(document.activeElement).toBe(feed);
  });

  it('abre Membros dentro da Comunidade e só consulta a lista após o clique', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(of(preview({
      community: {
        ...basePreview().community,
        source: { type: 'community', id: 'community-1' },
      },
      viewerMode: 'member',
      viewerRole: 'member',
      canInteract: false,
    })));
    const fixture = createFixture();
    const button = fixture.nativeElement.querySelector('#community-tab-members') as HTMLButtonElement;
    expect(button.textContent).toContain('Membros');
    expect(rosterRepositoryMock.getPage$).not.toHaveBeenCalled();

    button.click();
    fixture.detectChanges();

    expect(button.getAttribute('aria-selected')).toBe('true');
    expect(rosterRepositoryMock.getPage$).toHaveBeenCalledWith({
      communityId: 'community-1', cursor: null, limit: 20,
    });
    expect(fixture.nativeElement.querySelectorAll('h1')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('main')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.community-members__topbar')).toBeNull();
    expect(fixture.nativeElement.querySelector('#community-panel-members').textContent)
      .toContain('12 participantes');
  });

  it.each(['visitor', 'pending'] as const)(
    'não consulta nem expõe integrantes para %s',
    (viewerMode) => {
      previewRepositoryMock.getPreview$.mockReturnValue(of(preview({
        community: {
          ...basePreview().community,
          source: { type: 'community', id: 'community-1' },
        },
        viewerMode,
      })));
      const fixture = createFixture();
      fixture.nativeElement.querySelector('#community-tab-members').click();
      fixture.detectChanges();

      expect(rosterRepositoryMock.getPage$).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('app-community-members-page')).toBeNull();
      expect(fixture.nativeElement.querySelector('#community-panel-members').textContent)
        .toContain('somente para participantes ativos');
    }
  );

  it('não oferece Membros na navegação de Locais', () => {
    const fixture = createFixture();
    expect(fixture.nativeElement.querySelector('#community-tab-members')).toBeNull();
    expect(rosterRepositoryMock.getPage$).not.toHaveBeenCalled();
  });

  it('mantém título único, rota de retorno e submenu contextual de Local', () => {
    const fixture = createFixture();

    expect(fixture.componentInstance.backRoute).toBe('/dashboard/locais');
    expect(fixture.nativeElement.querySelectorAll('h1')).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelectorAll('.community-preview__tabs button')
    ).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('Local oficial');
    expect(fixture.nativeElement.textContent).toContain('Novidades');
    expect(fixture.nativeElement.textContent).toContain('Fotos');
    expect(fixture.nativeElement.textContent).toContain('Sobre');
    expect(fixture.nativeElement.textContent).not.toContain('Mural');
  });

  it('não repete descrição ou rótulo de visitante no cabeçalho', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).not.toContain(
      'Atualizações e fotos do Local.'
    );
    expect(fixture.nativeElement.textContent).not.toContain('Visitante');
  });

  it('mostra definição, descrição e métricas contextualizadas somente em Sobre', () => {
    const fixture = createFixture();

    sectionButton(fixture, 2).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Lugar físico ou estabelecimento real.'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Atualizações e fotos do Local.'
    );
    expect(fixture.nativeElement.textContent).toContain('12 pessoas conectadas');
    expect(fixture.nativeElement.textContent).toContain(
      'Interação reservada às pessoas autorizadas no Local'
    );
  });

  it('monta a associação oficial transversal na superfície de Local sem auto-link', () => {
    const fixture = createFixture();

    sectionButton(fixture, 2).click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(previewRepositoryMock.getOfficialCommunitiesForTarget$)
      .toHaveBeenCalledWith({ type: 'venue', id: 'venue-1' }, 4);
    expect(
      fixture.nativeElement.querySelector(
        'app-official-entity-community-section'
      )
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.official-community--current')
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Esta é a comunidade oficial deste Local'
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

  it('solicita acesso somente pela callable e recarrega a prévia', () => {
    const fixture = createFixture();
    const action = fixture.nativeElement.querySelector(
      '.community-preview__membership-action'
    ) as HTMLButtonElement;

    expect(action.textContent).toContain('Solicitar acesso');
    action.click();
    fixture.detectChanges();

    expect(membershipRepositoryMock.requestMembership$).toHaveBeenCalledWith(
      'community-1'
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Solicitação de acesso enviada.'
    );
    expect(previewRepositoryMock.getPreview$).toHaveBeenCalledTimes(2);
  });

  it('mantém estado pendente e permite cancelamento pela callable', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(preview({
        viewerMode: 'pending',
        viewerRole: 'member',
        canLeaveMembership: true,
      }))
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

  it('permite sair do Local com aprovação e retorna às Novidades', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(true) });
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(preview({
        viewerMode: 'member',
        viewerRole: 'member',
        canInteract: true,
        canLeaveMembership: true,
      }))
    );

    const fixture = createFixture();
    sectionButton(fixture, 2).click();
    fixture.detectChanges();
    const leave = fixture.nativeElement.querySelector(
      '.community-preview__membership-leave-action'
    ) as HTMLButtonElement;

    expect(leave.textContent).toContain('Sair do Local');
    leave.click();
    fixture.detectChanges();

    expect(membershipRepositoryMock.leaveMembership$).toHaveBeenCalledWith(
      'community-1'
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Você saiu do Local.'
    );
    expect(fixture.componentInstance.activeSection()).toBe('feed');
  });

  it('mantém Deixar de seguir apenas para Local com acompanhamento aberto', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(
        preview({
          viewerMode: 'member',
          viewerRole: 'member',
          canInteract: true,
          canLeaveMembership: true,
          community: {
            ...basePreview().community,
            access: {
              ...basePreview().community.access,
              join: 'open',
            },
          },
        })
      )
    );

    const fixture = createFixture();
    const leave = fixture.nativeElement.querySelector(
      '.community-preview__membership-leave-action'
    ) as HTMLButtonElement;

    expect(leave.textContent).toContain('Deixar de seguir');
  });

  it('não oferece acesso em Local somente por convite', () => {
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

  it('carrega a fila somente quando o backend libera Gestão', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(preview({
        viewerMode: 'moderator',
        viewerRole: 'moderator',
        canInteract: true,
        canManageMemberships: true,
      }))
    );

    const fixture = createFixture();

    const contentNav = fixture.nativeElement.querySelector(
      '.community-preview__tabs'
    ) as HTMLElement;
    const managementNav = fixture.nativeElement.querySelector(
      '.community-preview__management-nav'
    ) as HTMLElement;
    const managementButton = fixture.nativeElement.querySelector(
      '#community-tab-requests'
    ) as HTMLButtonElement;

    expect(contentNav.querySelectorAll('button')).toHaveLength(3);
    expect(contentNav.textContent).not.toContain('Gestão');
    expect(managementNav.textContent).toContain('Administração');
    expect(managementButton.textContent).toContain('Gestão');
    expect(membershipRepositoryMock.getMembershipRequests$).not.toHaveBeenCalled();

    managementButton.click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(membershipRepositoryMock.getMembershipRequests$).toHaveBeenCalledWith(
      'community-1'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma solicitação de acesso pendente.'
    );
  });

  it('mantém identidade e papel sem empilhar badges operacionais', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(preview({
        viewerMode: 'moderator',
        viewerRole: 'moderator',
        canInteract: true,
        canManageMemberships: true,
      }))
    );

    const fixture = createFixture();
    const labels = fixture.nativeElement.querySelector(
      '.community-preview__labels'
    ) as HTMLElement;
    const relationship = fixture.nativeElement.querySelector(
      '.community-preview__relationship'
    ) as HTMLElement;

    expect(labels.textContent?.replace(/\s+/g, ' ').trim()).toContain('Local');
    expect(labels.textContent).not.toContain('Moderação');
    expect(labels.textContent).not.toContain('Acesso por aprovação');
    expect(relationship.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Moderação'
    );
    expect(relationship.querySelector('.fa-shield')).not.toBeNull();
  });

  it('não inventa Gestão só porque o viewer continua moderador', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(preview({
        viewerMode: 'moderator',
        viewerRole: 'moderator',
        canInteract: true,
        canManageMemberships: false,
      }))
    );

    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).not.toContain('Gestão');
    expect(membershipRepositoryMock.getMembershipRequests$).not.toHaveBeenCalled();
  });

  it('usa Responsável para Local e Proprietário para Comunidade', () => {
    const component = TestBed.createComponent(
      CommunityPreviewPageComponent
    ).componentInstance;

    expect(component.viewerLabel('manager', 'owner', 'venue')).toBe(
      'Responsável'
    );
    expect(component.viewerLabel('manager', 'owner', 'community')).toBe(
      'Proprietário'
    );
  });

  it('explica indisponibilidade temporária ao integrante sem tratá-lo como visitante', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of(
        preview({
          viewerMode: 'member',
          viewerRole: 'member',
          canInteract: false,
        })
      )
    );

    const fixture = createFixture();
    sectionButton(fixture, 2).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Interações temporariamente indisponíveis'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Interação reservada às pessoas autorizadas no Local'
    );
  });
});
