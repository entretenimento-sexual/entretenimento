// src/app/community/discovery/community-discovery-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { filter, firstValueFrom, of, take } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

function venueCard() {
  return {
    communityId: 'community-local-1',
    name: 'Local Funcional',
    slug: 'local-funcional',
    description: 'Atualizações do lugar.',
    source: { type: 'venue' as const, id: 'venue-local-1' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval' as const,
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
    officialAssociation: {
      target: { type: 'venue' as const, id: 'venue-local-1' },
      verified: true as const,
    },
  };
}

describe('CommunityDiscoveryPageComponent / Locais', () => {
  const getDiscoveryPage$ = vi.fn();
  const getCommunityTagCatalog$ = vi.fn();
  const readSnapshot$ = vi.fn();
  const rememberPage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getDiscoveryPage$.mockReturnValue(
      of({
        items: [venueCard()],
        nextCursor: null,
        generatedAt: 123,
      })
    );
    getCommunityTagCatalog$.mockReturnValue(
      of({ items: [], generatedAt: 123 })
    );
    readSnapshot$.mockReturnValue(of(null));

    TestBed.configureTestingModule({
      imports: [CommunityDiscoveryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { sourceType: 'venue' },
              queryParamMap: convertToParamMap({}),
            },
            queryParamMap: of(convertToParamMap({})),
          },
        },
        {
          provide: AuthSessionService,
          useValue: { uid$: of(null) },
        },
        {
          provide: ProfilePreferencesService,
          useValue: { getProfile$: vi.fn(() => of(null)) },
        },
        {
          provide: CommunityPreviewRepository,
          useValue: { getDiscoveryPage$ },
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
          useValue: { getCommunityTagCatalog$ },
        },
        {
          provide: CommunityDiscoveryCacheService,
          useValue: { readSnapshot$, rememberPage },
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
  });

  it('carrega somente Locais e usa a rota canônica', async () => {
    const component = TestBed.runInInjectionContext(
      () => new CommunityDiscoveryPageComponent()
    );
    const state = await firstValueFrom(
      component.state$.pipe(
        filter((value) => value.status === 'ready'),
        take(1)
      )
    );

    expect(component.title).toBe('Locais');
    expect(component.description).toContain('Lugar físico');
    expect(component.canCreateVenue).toBe(true);
    expect(component.canFilterByTags).toBe(false);
    expect(getDiscoveryPage$).toHaveBeenCalledWith({
      limit: 12,
      cursor: null,
      sourceType: 'venue',
      tagId: null,
    });
    expect(rememberPage).toHaveBeenCalledOnce();
    expect(state.items).toHaveLength(1);
    expect(component.detailsRoute(state.items[0])).toEqual([
      '/dashboard/locais',
      'community-local-1',
    ]);
  });

  it('não repete Comunidades, Locais e Salas como navegação no corpo', () => {
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.community-discovery__tabs')
    ).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('h1')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Locais');
    expect(fixture.nativeElement.textContent).toContain('Local oficial');
    expect(fixture.nativeElement.textContent).not.toContain('Salas');
  });
});
