import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

const TAG_CATALOG = [
  { id: 'intent:friendship', label: 'Amizade', category: 'intent' as const },
  { id: 'practice:bdsm', label: 'BDSM', category: 'practice' as const },
  { id: 'audience:couple_mf', label: 'Casal MF', category: 'audience' as const },
] as const;

const DISCOVERY_CARD: CommunityPreviewCard = {
  communityId: 'community-swing-rio',
  name: 'Swing Rio',
  slug: 'swing-rio',
  description: 'Comunidade funcional para inspeção visual.',
  source: { type: 'community', id: 'community-swing-rio' },
  avatarUrl: null,
  coverUrl: null,
  tags: [
    { id: 'intent:swing', label: 'Swing', category: 'intent' },
  ],
  metrics: { memberCount: 100, postCount: 20, mediaCount: 8 },
  access: {
    join: 'approval',
    minimumRole: null,
    requiresActiveSubscription: false,
  },
};

describe('CommunityDiscoveryPageComponent / criação direta', () => {
  const getDiscoveryPage$ = vi.fn();
  const getCommunityTagCatalog$ = vi.fn();
  const requestCreation$ = vi.fn();
  const readSnapshot$ = vi.fn();
  const rememberPage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getDiscoveryPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: Date.now() })
    );
    getCommunityTagCatalog$.mockReturnValue(
      of({ items: TAG_CATALOG, generatedAt: Date.now() })
    );
    requestCreation$.mockReturnValue(of(void 0));
    readSnapshot$.mockReturnValue(of(null));

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
            uid$: of(null),
            readyUid$: of(null),
          },
        },
        {
          provide: ProfilePreferencesService,
          useValue: { getProfile$: vi.fn(() => of(null)) },
        },
        {
          provide: CommunityPreviewRepository,
          useValue: {
            getDiscoveryPage$,
            getMyCommunitiesPage$: vi.fn(),
          },
        },
        {
          provide: CommunityMembershipRepository,
          useValue: {
            getMembershipContext$: vi.fn(() =>
              of({ activeCommunityIds: [], generatedAt: Date.now() })
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
          useValue: { requestCreation$ },
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

  it('oferece um hub compacto de Comunidades com criação direta', () => {
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const createLink = fixture.nativeElement.querySelector(
      '.community-discovery__create'
    ) as HTMLAnchorElement | null;
    const heading = fixture.nativeElement.querySelector('h1') as HTMLElement | null;

    expect(heading?.textContent?.trim()).toBe('Comunidades');
    expect(createLink).not.toBeNull();
    expect(createLink?.textContent).toContain('Criar Comunidade');
    expect(createLink?.getAttribute('href')).toBe('/dashboard/comunidades/nova');
    expect(fixture.nativeElement.textContent).not.toContain('Sugerir Comunidade');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Grupo permanente de pessoas unidas'
    );

    createLink?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(requestCreation$).toHaveBeenCalledTimes(1);
  });

  it('usa chips rápidos e mantém o catálogo completo em Mais interesses', () => {
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const friendshipChip = fixture.nativeElement.querySelector(
      '.community-discovery__filter-chip[data-tag-id="intent:friendship"]'
    ) as HTMLButtonElement | null;
    const bdsmChip = fixture.nativeElement.querySelector(
      '.community-discovery__filter-chip[data-tag-id="practice:bdsm"]'
    ) as HTMLButtonElement | null;
    const select = fixture.nativeElement.querySelector(
      '.community-discovery__filter-control select'
    ) as HTMLSelectElement | null;

    expect(friendshipChip?.textContent?.trim()).toBe('Amizade');
    expect(bdsmChip?.textContent?.trim()).toBe('BDSM');
    expect(select?.querySelector('option[value="audience:couple_mf"]')?.textContent)
      .toContain('Casal MF');
  });

  it('reinicia o Explorar com a tag rápida canônica e a reflete na URL', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const bdsmChip = fixture.nativeElement.querySelector(
      '.community-discovery__filter-chip[data-tag-id="practice:bdsm"]'
    ) as HTMLButtonElement | null;

    expect(bdsmChip).not.toBeNull();
    bdsmChip?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedTagId()).toBe('practice:bdsm');
    expect(getDiscoveryPage$).toHaveBeenLastCalledWith({
      limit: 12,
      cursor: null,
      sourceType: 'community',
      tagId: 'practice:bdsm',
    });
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: { interesse: 'practice:bdsm' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    }));
  });

  it('restaura um filtro canônico recebido pela URL na primeira carga', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          data: { sourceType: 'community', discoveryMode: 'explore' },
          queryParamMap: convertToParamMap({ interesse: 'intent:friendship' }),
        },
        queryParamMap: of(
          convertToParamMap({ interesse: 'intent:friendship' })
        ),
      },
    });

    const component = TestBed.runInInjectionContext(
      () => new CommunityDiscoveryPageComponent()
    );
    component.state$.subscribe();

    expect(component.selectedTagId()).toBe('intent:friendship');
    expect(getDiscoveryPage$).toHaveBeenCalledWith({
      limit: 12,
      cursor: null,
      sourceType: 'community',
      tagId: 'intent:friendship',
    });
  });

  it('não expõe papel privado do viewer no Explorar mesmo se o payload o contiver', () => {
    getDiscoveryPage$.mockReturnValue(
      of({
        items: [{ ...DISCOVERY_CARD, viewerRole: 'owner' as const }],
        nextCursor: null,
        generatedAt: Date.now(),
      })
    );

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.componentInstance.membershipRoleLabel({
      ...DISCOVERY_CARD,
      viewerRole: 'owner',
    })).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.community-card__viewer-role')
    ).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Seu papel:');
  });

  it('gera identidade visual estável para a mesma Comunidade', () => {
    const component = TestBed.runInInjectionContext(
      () => new CommunityDiscoveryPageComponent()
    );

    const firstVariant = component.communityVisualVariant(DISCOVERY_CARD);
    const repeatedVariant = component.communityVisualVariant({
      ...DISCOVERY_CARD,
      name: 'Outro nome não altera a identidade técnica',
    });

    expect(firstVariant).toBeGreaterThanOrEqual(0);
    expect(firstVariant).toBeLessThan(6);
    expect(repeatedVariant).toBe(firstVariant);
    expect(component.communityInitials(DISCOVERY_CARD)).toBe('SR');
    expect(
      component.communityInitials({ ...DISCOVERY_CARD, name: 'BDSM' })
    ).toBe('BD');
  });

  it('usa iniciais no fallback e não repete o rótulo Comunidade no card', () => {
    getDiscoveryPage$.mockReturnValue(
      of({ items: [DISCOVERY_CARD], nextCursor: null, generatedAt: Date.now() })
    );

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.community-card');
    const media = fixture.nativeElement.querySelector('.community-card__media');
    const initials = fixture.nativeElement.querySelector('.community-card__initials');
    const metricsGroup = fixture.nativeElement.querySelector(
      '.community-card__metrics'
    ) as HTMLElement | null;
    const metrics = Array.from(
      fixture.nativeElement.querySelectorAll('.community-card__metrics > span')
    ) as HTMLElement[];

    expect(card).not.toBeNull();
    expect(initials?.textContent.trim()).toBe('SR');
    expect(media?.getAttribute('data-visual-variant')).toMatch(/^[0-5]$/);
    expect(card.querySelector('.community-card__kind')).toBeNull();
    expect(metricsGroup?.getAttribute('role')).toBe('group');
    expect(metrics.map((metric) => metric.getAttribute('aria-label'))).toEqual([
      '100 membros',
      '20 publicações',
      '8 mídias',
    ]);
  });

  it('preserva a identidade determinística quando capa e avatar falham', () => {
    getDiscoveryPage$.mockReturnValue(
      of({
        items: [
          {
            ...DISCOVERY_CARD,
            coverUrl: 'https://example.test/cover.webp',
            avatarUrl: 'https://example.test/avatar.webp',
          },
        ],
        nextCursor: null,
        generatedAt: Date.now(),
      })
    );

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const media = fixture.nativeElement.querySelector(
      '.community-card__media'
    ) as HTMLElement | null;
    const cover = fixture.nativeElement.querySelector(
      '.community-card__cover'
    ) as HTMLImageElement | null;
    const avatar = fixture.nativeElement.querySelector(
      '.community-card__identity img'
    ) as HTMLImageElement | null;
    const initials = fixture.nativeElement.querySelector(
      '.community-card__initials'
    ) as HTMLElement | null;

    cover?.dispatchEvent(new Event('error'));
    avatar?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(media?.getAttribute('data-visual-variant')).toMatch(/^[0-5]$/);
    expect(cover?.getAttribute('data-image-fallback')).toBe('applied');
    expect(avatar?.getAttribute('data-image-fallback')).toBe('applied');
    expect(initials?.textContent.trim()).toBe('SR');
  });
});
