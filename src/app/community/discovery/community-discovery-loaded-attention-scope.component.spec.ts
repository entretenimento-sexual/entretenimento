// src/app/community/discovery/community-discovery-loaded-attention-scope.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityNotificationPreferenceService } from 'src/app/core/services/notifications/community-notification-preference.service';
import { CommunityNotificationUnreadSummaryService } from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

function communityCard() {
  return {
    communityId: 'community-owned-1',
    name: 'Minha Comunidade',
    slug: 'minha-comunidade',
    description: 'Grupo administrado pelo usuário.',
    source: { type: 'community' as const, id: 'community-owned-1' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval' as const,
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
    viewerRole: 'owner' as const,
  };
}

describe('CommunityDiscoveryPageComponent / escopo de atenção carregada', () => {
  const getMyCommunitiesPage$ = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getMyCommunitiesPage$.mockReturnValue(of({
      items: [communityCard()],
      nextCursor: 'cursor-2',
      generatedAt: 123,
    }));

    TestBed.configureTestingModule({
      imports: [CommunityDiscoveryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { sourceType: 'community', discoveryMode: 'mine' },
              queryParamMap: convertToParamMap({}),
            },
            queryParamMap: of(convertToParamMap({})),
          },
        },
        {
          provide: AuthSessionService,
          useValue: { uid$: of(null), readyUid$: of(null) },
        },
        {
          provide: ProfilePreferencesService,
          useValue: { getProfile$: vi.fn(() => of(null)) },
        },
        {
          provide: CommunityPreviewRepository,
          useValue: {
            getDiscoveryPage$: vi.fn(),
            getMyCommunitiesPage$,
          },
        },
        {
          provide: CommunityMembershipRepository,
          useValue: {
            getMembershipContext$: vi.fn(() =>
              of({ activeCommunityIds: [], generatedAt: 123 })
            ),
          },
        },
        {
          provide: CommunityTagRepository,
          useValue: { getCommunityTagCatalog$: vi.fn() },
        },
        {
          provide: CommunityDiscoveryCacheService,
          useValue: {
            readSnapshot$: vi.fn(() => of(null)),
            rememberPage: vi.fn(),
          },
        },
        {
          provide: CommunityCreationGateService,
          useValue: { requestCreation$: vi.fn(() => of(void 0)) },
        },
        {
          provide: CommunityNotificationUnreadSummaryService,
          useValue: { currentUserSummaryMap$: of(new Map()) },
        },
        {
          provide: CommunityNotificationPreferenceService,
          useValue: {
            currentUserMutedCommunityIds$: of(new Set()),
            updateMuted$: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError: vi.fn(), showWarning: vi.fn() },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });
  });

  it('explica que a prioridade vale para itens carregados e conecta a descrição à lista e à paginação', () => {
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const scope = fixture.nativeElement.querySelector(
      '#community-mine-attention-scope'
    ) as HTMLElement | null;
    const grid = fixture.nativeElement.querySelector(
      '.community-discovery__grid'
    ) as HTMLUListElement | null;
    const loadMore = fixture.nativeElement.querySelector(
      'button[aria-label="Ver mais comunidades"]'
    ) as HTMLButtonElement | null;

    expect(scope?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      'As Comunidades carregadas são organizadas por atenção; ao ver mais, novas atividades podem aparecer acima.'
    );
    expect(grid?.getAttribute('aria-describedby')).toBe(
      'community-mine-attention-scope'
    );
    expect(grid?.getAttribute('aria-busy')).toBe('false');
    expect(loadMore?.getAttribute('aria-describedby')).toBe(
      'community-mine-attention-scope'
    );
    expect(loadMore?.getAttribute('aria-busy')).toBe('false');
    expect(getMyCommunitiesPage$).toHaveBeenCalledWith({
      limit: 12,
      cursor: null,
      sourceType: 'community',
    });
  });
});
