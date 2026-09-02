// src/app/community/discovery/community-discovery-my-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { filter, firstValueFrom, of, take } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
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
    tags: [
      { id: 'intent:friendship', label: 'Amizade', category: 'intent' as const },
    ],
    viewerRole: 'owner' as const,
  };
}

describe('CommunityDiscoveryPageComponent / Minhas comunidades', () => {
  const getDiscoveryPage$ = vi.fn();
  const getMyCommunitiesPage$ = vi.fn();
  const readSnapshot$ = vi.fn();
  const rememberPage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getMyCommunitiesPage$.mockReturnValue(
      of({
        items: [communityCard()],
        nextCursor: null,
        generatedAt: 123,
      })
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
              data: { sourceType: 'community', discoveryMode: 'mine' },
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
          useValue: { getDiscoveryPage$, getMyCommunitiesPage$ },
        },
        {
          provide: CommunityTagRepository,
          useValue: { getCommunityTagCatalog$: vi.fn() },
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

  it('usa a callable privada e não a descoberta global', async () => {
    const component = TestBed.runInInjectionContext(
      () => new CommunityDiscoveryPageComponent()
    );
    const state = await firstValueFrom(
      component.state$.pipe(
        filter((value) => value.status === 'ready'),
        take(1)
      )
    );

    expect(component.discoveryMode).toBe('mine');
    expect(component.title).toBe('Minhas comunidades');
    expect(component.canFilterByTags).toBe(false);
    expect(getMyCommunitiesPage$).toHaveBeenCalledWith({
      limit: 12,
      cursor: null,
      sourceType: 'community',
    });
    expect(getDiscoveryPage$).not.toHaveBeenCalled();
    expect(state.items.map((item) => item.communityId)).toEqual([
      'community-owned-1',
    ]);
    expect(state.items[0]?.viewerRole).toBe('owner');
  });

  it('prioriza papel e atividade no card de Minhas sem repetir dados de descoberta', () => {
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '.community-card--mine'
    ) as HTMLElement | null;
    const role = fixture.nativeElement.querySelector(
      '.community-card__viewer-role'
    ) as HTMLElement | null;
    const metrics = Array.from(
      fixture.nativeElement.querySelectorAll('.community-card__metrics--mine > span')
    ) as HTMLElement[];

    expect(card).not.toBeNull();
    expect(role?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Proprietário');
    expect(role?.querySelector('.fa-user-check')).not.toBeNull();
    expect(card?.querySelector('p')).toBeNull();
    expect(card?.querySelector('.community-card__tags')).toBeNull();
    expect(metrics.map((metric) => metric.getAttribute('aria-label'))).toEqual([
      '0 publicações',
      '0 mídias',
      '1 membros',
    ]);
  });

  it('orienta Minhas vazio para Explorar sem duplicar o CTA de criação', () => {
    getMyCommunitiesPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const emptyState = fixture.nativeElement.querySelector(
      '.community-discovery__state--mine-empty'
    ) as HTMLElement | null;
    const exploreLink = fixture.nativeElement.querySelector(
      '.community-discovery__empty-explore'
    ) as HTMLAnchorElement | null;

    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent).toContain(
      'Você ainda não participa de Comunidades'
    );
    expect(emptyState?.textContent).toContain(
      'Explore espaços que combinam com seus interesses'
    );
    expect(exploreLink?.getAttribute('href')).toBe('/dashboard/comunidades');
    expect(
      fixture.nativeElement.querySelector('.community-discovery__empty-create')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelectorAll('.community-discovery__create')
    ).toHaveLength(1);
  });

  it('restaura snapshot fresco sem repetir a callable privada', async () => {
    getMyCommunitiesPage$.mockClear();
    readSnapshot$.mockReturnValue(
      of({
        fresh: true,
        page: {
          items: [communityCard()],
          nextCursor: 'cursor-2',
          generatedAt: 456,
        },
      })
    );

    const component = TestBed.runInInjectionContext(
      () => new CommunityDiscoveryPageComponent()
    );
    const state = await firstValueFrom(
      component.state$.pipe(
        filter((value) => value.status === 'ready'),
        take(1)
      )
    );

    expect(state.nextCursor).toBe('cursor-2');
    expect(getMyCommunitiesPage$).not.toHaveBeenCalled();
  });
});
