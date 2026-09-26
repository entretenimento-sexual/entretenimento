// src/app/community/discovery/community-discovery-my-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, filter, firstValueFrom, of, take } from 'rxjs';
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
import { CommunityDiscoveryDataFacade } from './community-discovery-data.facade';
import { CommunityDiscoveryMineFacade } from './community-discovery-mine.facade';
import { CommunityDiscoverySponsoredFacade } from './community-discovery-sponsored.facade';
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

function communityCard(
  communityId = 'community-owned-1',
  name = 'Minha Comunidade',
  viewerRole: 'owner' | 'admin' | 'moderator' | 'member' = 'owner'
) {
  return {
    communityId,
    name,
    slug: communityId,
    description: 'Grupo administrado pelo usuário.',
    source: { type: 'community' as const, id: communityId },
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
    viewerRole,
  };
}

describe('CommunityDiscoveryPageComponent / Minhas comunidades', () => {
  const getDiscoveryPage$ = vi.fn();
  const getMyCommunitiesPage$ = vi.fn();
  const getMembershipContext$ = vi.fn();
  const readSnapshot$ = vi.fn();
  const rememberPage = vi.fn();
  const updateMuted$ = vi.fn();
  let unreadSummaryMap$: BehaviorSubject<ReadonlyMap<string, {
    communityId: string;
    unreadCount: number;
    priorityUnreadCount: number;
    hasPriorityUnread: boolean;
    updatedAt: number | null;
  }>>;
  let mutedCommunityIds$: BehaviorSubject<ReadonlySet<string>>;

  beforeEach(() => {
    vi.clearAllMocks();
    unreadSummaryMap$ = new BehaviorSubject<ReadonlyMap<string, {
      communityId: string;
      unreadCount: number;
      priorityUnreadCount: number;
      hasPriorityUnread: boolean;
      updatedAt: number | null;
    }>>(new Map());
    mutedCommunityIds$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
    getMyCommunitiesPage$.mockReturnValue(
      of({
        items: [communityCard()],
        nextCursor: null,
        generatedAt: 123,
      })
    );
    getMembershipContext$.mockReturnValue(
      of({ activeCommunityIds: [], generatedAt: 123 })
    );
    updateMuted$.mockReturnValue(
      of({ communityId: 'community-owned-1', muted: true })
    );
    readSnapshot$.mockReturnValue(of(null));

    TestBed.configureTestingModule({
      imports: [CommunityDiscoveryPageComponent],
      providers: [
        CommunityDiscoveryDataFacade,
        CommunityDiscoveryMineFacade,
        CommunityDiscoverySponsoredFacade,
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
          useValue: { getDiscoveryPage$, getMyCommunitiesPage$ },
        },
        {
          provide: CommunityMembershipRepository,
          useValue: { getMembershipContext$ },
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
          provide: CommunityNotificationUnreadSummaryService,
          useValue: { currentUserSummaryMap$: unreadSummaryMap$ },
        },
        {
          provide: CommunityNotificationPreferenceService,
          useValue: {
            currentUserMutedCommunityIds$: mutedCommunityIds$,
            updateMuted$,
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

  it('usa a callable privada e não a descoberta global', async () => {
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    const component = fixture.componentInstance;
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
    expect(getMembershipContext$).not.toHaveBeenCalled();
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
      '.community-card__relationship'
    ) as HTMLElement | null;
    const metrics = Array.from(
      fixture.nativeElement.querySelectorAll('.community-card__metrics--mine > span')
    ) as HTMLElement[];

    expect(card).not.toBeNull();
    expect(role?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Proprietário');
    expect(role?.querySelector('.fa-crown')).not.toBeNull();
    expect(card?.querySelector('p')).toBeNull();
    expect(card?.querySelector('.community-card__tags')).toBeNull();
    expect(metrics.map((metric) => metric.getAttribute('aria-label'))).toEqual([
      '0 publicações',
      '0 mídias',
      '1 membros',
    ]);
  });

  it('explica atenção e mute sem expor detalhes técnicos de paginação', () => {
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const definition = fixture.nativeElement.querySelector(
      '#community-mine-attention-scope'
    ) as HTMLElement | null;
    const text = definition?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain(
      'As comunidades com novidades importantes aparecem primeiro.'
    );
    expect(text).toContain('Silenciar alertas reduz notificações push');
    expect(text).not.toContain('ao ver mais');
    expect(text).not.toContain('Comunidades carregadas');
  });

  it('combina unread, prioridade e mute a partir dos streams agregados', () => {
    unreadSummaryMap$.next(new Map([
      [
        'community-owned-1',
        {
          communityId: 'community-owned-1',
          unreadCount: 7,
          priorityUnreadCount: 2,
          hasPriorityUnread: true,
          updatedAt: 123,
        },
      ],
    ]));
    mutedCommunityIds$.next(new Set(['community-owned-1']));

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const unread = fixture.nativeElement.querySelector(
      '[aria-label="7 atividades não lidas, incluindo atividade prioritária"]'
    ) as HTMLElement | null;
    const preferenceButton = fixture.nativeElement.querySelector(
      'button[aria-pressed="true"]'
    ) as HTMLButtonElement | null;
    const operationalStatuses = fixture.nativeElement.querySelectorAll(
      '.community-card__attention'
    );

    expect(unread?.textContent?.replace(/\s+/g, ' ').trim()).toBe('7 não lidas');
    expect(unread?.querySelector('.fa-bolt')).not.toBeNull();
    expect(operationalStatuses).toHaveLength(1);
    expect(preferenceButton?.textContent).toContain('Reativar');
  });

  it('ordena Minhas por atenção sem deixar mute reduzir a prioridade', () => {
    getMyCommunitiesPage$.mockReturnValue(
      of({
        items: [
          communityCard('community-quiet', 'Em dia'),
          communityCard('community-unread', 'Com novidades'),
          communityCard('community-priority', 'Prioritária'),
        ],
        nextCursor: null,
        generatedAt: 123,
      })
    );
    unreadSummaryMap$.next(new Map([
      [
        'community-unread',
        {
          communityId: 'community-unread',
          unreadCount: 40,
          priorityUnreadCount: 0,
          hasPriorityUnread: false,
          updatedAt: 200,
        },
      ],
      [
        'community-priority',
        {
          communityId: 'community-priority',
          unreadCount: 2,
          priorityUnreadCount: 1,
          hasPriorityUnread: true,
          updatedAt: 100,
        },
      ],
    ]));
    mutedCommunityIds$.next(new Set(['community-priority']));

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const names = Array.from(
      fixture.nativeElement.querySelectorAll('.community-card--mine h2')
    ).map((heading) => (heading as HTMLElement).textContent?.trim());
    const firstShell = fixture.nativeElement.querySelector(
      '.community-card-shell--mine'
    ) as HTMLElement | null;

    expect(names).toEqual(['Prioritária', 'Com novidades', 'Em dia']);
    expect(firstShell?.getAttribute('data-attention')).toBe('priority');
    expect(firstShell?.classList.contains('is-muted')).toBe(true);
    expect(firstShell?.textContent).toContain('Reativar');
  });

  it('nomeia os grupos de triagem para alta participação', () => {
    getMyCommunitiesPage$.mockReturnValue(
      of({
        items: [
          communityCard('community-quiet', 'Demais'),
          communityCard('community-unread', 'Novas'),
          communityCard('community-priority', 'Atenção'),
        ],
        nextCursor: null,
        generatedAt: 123,
      })
    );
    unreadSummaryMap$.next(new Map([
      [
        'community-unread',
        {
          communityId: 'community-unread',
          unreadCount: 3,
          priorityUnreadCount: 0,
          hasPriorityUnread: false,
          updatedAt: 200,
        },
      ],
      [
        'community-priority',
        {
          communityId: 'community-priority',
          unreadCount: 1,
          priorityUnreadCount: 1,
          hasPriorityUnread: true,
          updatedAt: 300,
        },
      ],
    ]));

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const headings = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.community-discovery__attention-heading h2'
      )
    ).map((heading) =>
      (heading as HTMLElement).textContent?.replace(/\s+/g, ' ').trim()
    );

    expect(headings).toEqual([
      'Precisa de atenção',
      'Novas atividades',
      'Demais',
    ]);
  });

  it('habilita busca apenas com volume e filtra participações sem nova chamada', () => {
    const items = [
      communityCard('community-owner', 'Alpha', 'owner'),
      communityCard('community-admin', 'Beta', 'admin'),
      communityCard('community-moderator', 'Gamma', 'moderator'),
      communityCard('community-member-1', 'Música Brasileira', 'member'),
      communityCard('community-member-2', 'Delta', 'member'),
      communityCard('community-member-3', 'Epsilon', 'member'),
      communityCard('community-member-4', 'Zeta', 'member'),
      communityCard('community-member-5', 'Eta', 'member'),
    ];
    getMyCommunitiesPage$.mockReturnValue(
      of({ items, nextCursor: 'cursor-2', generatedAt: 123 })
    );
    mutedCommunityIds$.next(new Set(['community-member-2']));

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector(
      '.community-discovery__mine-search input'
    ) as HTMLInputElement | null;
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.community-discovery__mine-filter-strip button'
      )
    ) as HTMLButtonElement[];

    expect(search).not.toBeNull();
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Todas',
      'Administradas',
      'Participo',
      'Silenciadas',
    ]);

    buttons.find((button) => button.textContent?.trim() === 'Administradas')
      ?.click();
    fixture.detectChanges();

    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.community-card--mine h2')
      ).map((heading) => (heading as HTMLElement).textContent?.trim())
    ).toEqual(['Alpha', 'Beta', 'Gamma']);

    buttons.find((button) => button.textContent?.trim() === 'Todas')?.click();
    fixture.detectChanges();

    const searchAfterFilter = fixture.nativeElement.querySelector(
      '.community-discovery__mine-search input'
    ) as HTMLInputElement;
    searchAfterFilter.value = 'musica';
    searchAfterFilter.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.community-card--mine h2')
      ).map((heading) => (heading as HTMLElement).textContent?.trim())
    ).toEqual(['Música Brasileira']);

    expect(getMyCommunitiesPage$).toHaveBeenCalledTimes(1);
  });

  it('integra mute ao card visual sem aninhar botão no link navegável', () => {
    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const shell = fixture.nativeElement.querySelector(
      '.community-card-shell--mine'
    ) as HTMLElement | null;
    const card = fixture.nativeElement.querySelector(
      '.community-card--mine'
    ) as HTMLAnchorElement | null;
    const actions = fixture.nativeElement.querySelector(
      '[role="group"][aria-label="Ações rápidas de Minha Comunidade"]'
    ) as HTMLElement | null;
    const preferenceButton = fixture.nativeElement.querySelector(
      'button[aria-label="Silenciar alertas push de Minha Comunidade"]'
    ) as HTMLButtonElement | null;

    expect(card?.querySelector('button')).toBeNull();
    expect(preferenceButton).not.toBeNull();
    expect(shell?.contains(preferenceButton)).toBe(true);
    expect(actions?.contains(preferenceButton)).toBe(true);

    preferenceButton?.click();
    fixture.detectChanges();

    expect(updateMuted$).toHaveBeenCalledWith('community-owned-1', true);
    expect(fixture.nativeElement.textContent).toContain(
      'alertas push silenciados. A atividade continua na Central.'
    );
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

  it('restaura continuidade multipágina fresca sem repetir a callable privada', async () => {
    getMyCommunitiesPage$.mockClear();
    const cachedItems = Array.from({ length: 13 }, (_, index) =>
      communityCard(
        `community-cached-${index + 1}`,
        `Comunidade ${index + 1}`
      )
    );
    readSnapshot$.mockReturnValue(
      of({
        fresh: true,
        page: {
          items: cachedItems,
          nextCursor: 'cursor-3',
          generatedAt: 456,
        },
      })
    );

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    const component = fixture.componentInstance;
    const state = await firstValueFrom(
      component.state$.pipe(
        filter((value) => value.status === 'ready'),
        take(1)
      )
    );

    expect(state.items).toHaveLength(13);
    expect(state.items.at(-1)?.communityId).toBe('community-cached-13');
    expect(state.nextCursor).toBe('cursor-3');
    expect(getMyCommunitiesPage$).not.toHaveBeenCalled();
    expect(rememberPage).not.toHaveBeenCalled();
  });
});