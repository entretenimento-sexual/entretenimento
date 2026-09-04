import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import type { PreferenceProfile } from 'src/app/preferences/models/preference-profile.model';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

const CONTEXTUAL_PROFILE: PreferenceProfile = {
  userId: 'viewer-1',
  relationshipIntents: [],
  hardRules: {
    acceptedGenders: [],
    acceptedRelationshipIntents: [],
    ageRange: null,
    maxDistanceKm: null,
    acceptsCouples: true,
    acceptsSingles: true,
    acceptsTransProfiles: null,
    locationRequired: false,
  },
  softRules: {
    bodyPreferences: [],
    sexualPractices: ['swing'],
    vibes: [],
    styles: [],
    interests: [],
  },
  selfTraits: { bodyTraits: [] },
  matchingModes: {
    relationshipIntents: 'prefer',
    sexualPractices: 'prefer',
    bodyPreferences: 'prefer',
  },
  visibility: {
    showPreferenceBadges: false,
    showIntentPublicly: false,
    discoveryMode: 'standard',
  },
  updatedAt: 123,
};

function card(
  communityId: string,
  name: string,
  tags: CommunityPreviewCard['tags']
): CommunityPreviewCard {
  return {
    communityId,
    name,
    slug: communityId,
    description: `Descrição de ${name}.`,
    source: { type: 'community', id: communityId },
    avatarUrl: null,
    coverUrl: null,
    tags,
    metrics: { memberCount: 20, postCount: 4, mediaCount: 1 },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
  };
}

describe('CommunityDiscoveryPageComponent / apresentação contextual', () => {
  it('personaliza somente a apresentação, preserva a âncora orgânica e não altera o cache', () => {
    const organicFirst = card('community-organic', 'Primeira orgânica', []);
    const neutralSecond = card('community-neutral', 'Segunda orgânica', []);
    const relevant = card('community-swing', 'Swing relevante', [
      { id: 'intent:swing', label: 'Swing', category: 'intent' },
    ]);
    const organicPage = {
      items: [organicFirst, neutralSecond, relevant],
      nextCursor: null,
      generatedAt: 456,
    };
    const rememberPage = vi.fn();

    TestBed.configureTestingModule({
      imports: [CommunityDiscoveryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { sourceType: 'community', discoveryMode: 'explore' },
              queryParamMap: convertToParamMap({}),
            },
            queryParamMap: of(convertToParamMap({})),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('viewer-1'),
            readyUid$: of('viewer-1'),
          },
        },
        {
          provide: ProfilePreferencesService,
          useValue: { getProfile$: vi.fn(() => of(CONTEXTUAL_PROFILE)) },
        },
        {
          provide: CommunityPreviewRepository,
          useValue: {
            getDiscoveryPage$: vi.fn(() => of(organicPage)),
            getMyCommunitiesPage$: vi.fn(),
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
          useValue: {
            getCommunityTagCatalog$: vi.fn(() =>
              of({
                items: [
                  {
                    id: 'intent:swing',
                    label: 'Swing',
                    category: 'intent',
                    preferenceSignals: [
                      { domain: 'sexualPractice', key: 'swing' },
                    ],
                  },
                ],
                generatedAt: 123,
              })
            ),
          },
        },
        {
          provide: CommunityDiscoveryCacheService,
          useValue: {
            readSnapshot$: vi.fn(() => of(null)),
            rememberPage,
          },
        },
        {
          provide: CommunityCreationGateService,
          useValue: { requestCreation$: vi.fn(() => of(void 0)) },
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

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const headings = Array.from(
      fixture.nativeElement.querySelectorAll('.community-card h2')
    ).map((element) => (element as HTMLElement).textContent?.trim());
    const contextualBadge = fixture.nativeElement.querySelector(
      '.community-card__contextual-match'
    ) as HTMLElement | null;

    expect(headings).toEqual([
      'Primeira orgânica',
      'Swing relevante',
      'Segunda orgânica',
    ]);
    expect(contextualBadge?.textContent).toContain('Combina com 1 interesse seu');
    expect(contextualBadge?.textContent).not.toMatch(/%/);
    expect(rememberPage).toHaveBeenCalledWith(
      expect.anything(),
      organicPage,
      false
    );
    expect(organicPage.items.map((item) => item.communityId)).toEqual([
      'community-organic',
      'community-neutral',
      'community-swing',
    ]);
  });
});