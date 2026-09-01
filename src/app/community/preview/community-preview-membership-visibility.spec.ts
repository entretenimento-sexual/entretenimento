import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityInviteRepository } from '../data-access/community-invite.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import type {
  CommunityPreviewLifecycleStatus,
  CommunityPreviewResponse,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityPreviewPageComponent } from './community-preview-page.component';

type JoinPolicy = 'open' | 'approval' | 'invite_only';

function visitorCapacity(memberCount = 12): CommunityPreviewResponse['capacity'] {
  return {
    configuredLimit: 25,
    effectiveLimit: 25,
    memberCount,
    acceptingNewMembers: memberCount < 25,
    restrictedByOwnerPlan: false,
    memberLimitOptions: [],
    allowedMemberLimits: [],
  };
}

function buildPreview(join: JoinPolicy): CommunityPreviewResponse {
  return {
    community: {
      communityId: 'community-1',
      name: 'Comunidade Teste',
      slug: 'comunidade-teste',
      description: 'Comunidade usada para validar a comunicação de entrada.',
      source: { type: 'community' as const, id: 'community-1' },
      avatarUrl: null,
      coverUrl: null,
      tags: [
        { id: 'intent:friendship', label: 'Amizade', category: 'intent' as const },
        { id: 'practice:bdsm', label: 'BDSM', category: 'practice' as const },
      ],
      metrics: { memberCount: 12, postCount: 4, mediaCount: 3 },
      access: {
        join,
        minimumRole: null,
        requiresActiveSubscription: false,
      },
    },
    rules: 'Respeite os participantes.\nPreserve a privacidade de todos.',
    lifecycleStatus: 'active' as CommunityPreviewLifecycleStatus,
    viewerMode: 'visitor' as const,
    viewerRole: null,
    canInteract: false,
    canManageMemberships: false,
    canInviteCommunityMembers: false,
    canManageCommunitySettings: false,
    capacity: visitorCapacity(),
    settings: null,
    canLeaveMembership: false,
    generatedAt: 123,
  };
}

describe('CommunityPreviewPageComponent / comunicação de adesão', () => {
  const previewRepositoryMock = { getPreview$: vi.fn() };
  const membershipRepositoryMock = {
    requestMembership$: vi.fn(),
    leaveMembership$: vi.fn(),
    getMembershipRequests$: vi.fn(),
    reviewMembership$: vi.fn(),
  };
  const inviteRepositoryMock = {
    getSentInvites$: vi.fn(() => of({ items: [], generatedAt: 123 })),
    findCandidate$: vi.fn(),
    sendInvite$: vi.fn(),
    revokeInvite$: vi.fn(),
  };
  const photoEditorMock = {
    editFile$: vi.fn(() => of(null)),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { backRoute: '/dashboard/comunidades' } },
            paramMap: of(convertToParamMap({ communityId: 'community-1' })),
          },
        },
        { provide: CommunityPreviewRepository, useValue: previewRepositoryMock },
        {
          provide: CommunityFeedRepository,
          useValue: {
            getPage$: vi.fn(() =>
              of({ items: [], nextCursor: null, generatedAt: 123 })
            ),
            getItems$: vi.fn(() =>
              of({ items: [], nextCursor: null, generatedAt: 123 })
            ),
            watchLatestChanges$: vi.fn(() => of([])),
          },
        },
        { provide: CommunityMembershipRepository, useValue: membershipRepositoryMock },
        { provide: CommunityInviteRepository, useValue: inviteRepositoryMock },
        { provide: PhotoEditorLauncherService, useValue: photoEditorMock },
        {
          provide: ContentAccessNavigationService,
          useValue: { navigateForDecision: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });
  });

  function createFixture(
    join: JoinPolicy,
    overrides: Partial<ReturnType<typeof buildPreview>> = {}
  ) {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of({ ...buildPreview(join), ...overrides })
    );
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('expõe no cabeçalho quando a entrada depende de aprovação', () => {
    const fixture = createFixture('approval');
    const labels = fixture.nativeElement.querySelector(
      '.community-preview__labels'
    ) as HTMLElement | null;
    const action = fixture.nativeElement.querySelector(
      '.community-preview__membership-action'
    ) as HTMLButtonElement | null;

    expect(labels?.textContent).toContain('Entrada por aprovação');
    expect(action).not.toBeNull();
    expect(action?.textContent).toContain('Solicitar');
  });

  it('substitui a ação de entrada por um estado claro ao atingir a capacidade', () => {
    const fixture = createFixture('open', {
      capacity: visitorCapacity(25),
    });

    expect(
      fixture.nativeElement.querySelector('.community-preview__membership-action')
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Entradas pausadas');
  });

  it('mostra as regras antes da entrada e as mantém sem duplicação em Sobre', () => {
    const fixture = createFixture('approval');
    const action = fixture.nativeElement.querySelector(
      '.community-preview__membership-action'
    ) as HTMLButtonElement | null;
    const beforeEntry = fixture.nativeElement.querySelector(
      '.community-preview__rules--before-entry'
    ) as HTMLElement | null;

    expect(beforeEntry?.textContent).toContain('Leia antes de participar');
    expect(beforeEntry?.textContent).toContain('Respeite os participantes.');
    expect(action?.getAttribute('aria-describedby')).toBe(
      'community-preview-rules-before-entry-copy'
    );

    const about = fixture.nativeElement.querySelector(
      '#community-tab-about'
    ) as HTMLButtonElement | null;
    about?.click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.community-preview__rules--before-entry')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelectorAll('.community-preview__rules')
    ).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('.community-preview__rules--about')
        ?.textContent
    ).toContain('Preserve a privacidade de todos.');
  });

  it('renderiza somente os banners de lifecycle não ativo enviados pelo backend', () => {
    const notices = [
      ['paused', 'Comunidade pausada'],
      ['dormant', 'Comunidade pouco ativa'],
      ['archived', 'Comunidade arquivada'],
      ['scheduled_for_deletion', 'Comunidade em encerramento'],
    ] as const;

    const activeFixture = createFixture('approval');
    expect(
      activeFixture.nativeElement.querySelector('.community-preview__lifecycle')
    ).toBeNull();
    activeFixture.destroy();

    for (const [lifecycleStatus, title] of notices) {
      const fixture = createFixture('approval', { lifecycleStatus });
      const banner = fixture.nativeElement.querySelector(
        '.community-preview__lifecycle'
      ) as HTMLElement | null;

      expect(banner?.dataset['lifecycleStatus']).toBe(lifecycleStatus);
      expect(banner?.textContent).toContain(title);
      fixture.destroy();
    }
  });

  it('mantém a identidade determinística do card quando a prévia não tem mídia', () => {
    const fixture = createFixture('approval');
    const component = fixture.componentInstance;
    const community = buildPreview('approval').community;
    const cover = fixture.nativeElement.querySelector(
      '.community-preview__cover'
    ) as HTMLElement | null;
    const fallback = fixture.nativeElement.querySelector(
      '.community-preview__avatar-fallback'
    ) as HTMLElement | null;
    const variant = component.communityVisualVariant(community);

    expect(variant).toBeGreaterThanOrEqual(0);
    expect(variant).toBeLessThan(6);
    expect(cover?.getAttribute('data-visual-variant')).toBe(String(variant));
    expect(fallback?.textContent.trim()).toBe('CT');
    expect(
      component.communityVisualVariant({ ...community, name: 'Outro Nome' })
    ).toBe(variant);
    expect(component.communityInitials({ ...community, name: 'Outro Nome' })).toBe(
      'ON'
    );
    expect(fixture.nativeElement.querySelector('.community-preview__avatar .fa-user-group'))
      .toBeNull();
  });

  it('preserva iniciais e variante quando capa e avatar falham ao carregar', () => {
    const base = buildPreview('approval');
    previewRepositoryMock.getPreview$.mockReturnValue(
      of({
        ...base,
        community: {
          ...base.community,
          avatarUrl: 'https://example.test/avatar.webp',
          coverUrl: 'https://example.test/cover.webp',
        },
      })
    );

    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const cover = fixture.nativeElement.querySelector(
      '.community-preview__cover'
    ) as HTMLElement | null;
    const coverImage = cover?.querySelector('img') as HTMLImageElement | null;
    const avatarImage = fixture.nativeElement.querySelector(
      '.community-preview__avatar img'
    ) as HTMLImageElement | null;
    const fallback = fixture.nativeElement.querySelector(
      '.community-preview__avatar-fallback'
    ) as HTMLElement | null;

    coverImage?.dispatchEvent(new Event('error'));
    avatarImage?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(cover?.getAttribute('data-visual-variant')).toMatch(/^[0-5]$/);
    expect(coverImage?.getAttribute('data-image-fallback')).toBe('applied');
    expect(avatarImage?.getAttribute('data-image-fallback')).toBe('applied');
    expect(fallback?.textContent.trim()).toBe('CT');
  });

  it('explica somente convite uma única vez sem expor uma ação impossível', () => {
    const fixture = createFixture('invite_only');
    const labels = fixture.nativeElement.querySelector(
      '.community-preview__labels'
    ) as HTMLElement | null;
    const state = fixture.nativeElement.querySelector(
      '.community-preview__membership-state'
    ) as HTMLElement | null;
    const inviteOnlyOccurrences = String(fixture.nativeElement.textContent ?? '')
      .split('Somente convite')
      .length - 1;

    expect(labels?.textContent).not.toContain('Somente convite');
    expect(state?.textContent).toContain('Somente convite');
    expect(inviteOnlyOccurrences).toBe(1);
    expect(state?.querySelector('.fa-lock')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.community-preview__membership-action')
    ).toBeNull();
    expect(membershipRepositoryMock.requestMembership$).not.toHaveBeenCalled();
  });

  it('mostra as tags canônicas somente na área informativa Sobre', () => {
    const fixture = createFixture('approval');

    expect(
      fixture.nativeElement.querySelector('.community-preview__tags')
    ).toBeNull();

    const about = fixture.nativeElement.querySelector(
      '#community-tab-about'
    ) as HTMLButtonElement | null;
    about?.click();
    fixture.detectChanges();

    const tags = fixture.nativeElement.querySelector(
      '.community-preview__tags'
    ) as HTMLElement | null;
    const chips = Array.from(
      tags?.querySelectorAll('.app-chip') ?? []
    ) as HTMLElement[];

    expect(tags?.getAttribute('aria-label')).toBe(
      'Interesses e afinidades deste espaço'
    );
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
      '#Amizade',
      '#BDSM',
    ]);
  });

  it('libera a jornada de convite para membro somente pela capability', () => {
    const fixture = createFixture('invite_only', {
      viewerMode: 'member',
      viewerRole: 'member',
      canInteract: true,
      canInviteCommunityMembers: true,
    });
    const inviteTab = fixture.nativeElement.querySelector(
      '#community-tab-invites'
    ) as HTMLButtonElement | null;

    expect(inviteTab).not.toBeNull();
    inviteTab?.click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('app-community-invite-management')
    ).not.toBeNull();
    expect(inviteRepositoryMock.getSentInvites$).toHaveBeenCalledWith(
      'community-1'
    );
  });
});
