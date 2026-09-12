// src/app/community/discovery/community-discovery-loaded-attention-scope.component.spec.ts
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
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

function communityCard(
  communityId = 'community-owned-1',
  name = 'Minha Comunidade'
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
    tags: [],
    viewerRole: 'owner' as const,
  };
}

type NotificationSummary = {
  communityId: string;
  unreadCount: number;
  priorityUnreadCount: number;
  hasPriorityUnread: boolean;
  updatedAt: number | null;
};

describe('CommunityDiscoveryPageComponent / escopo de atenção carregada', () => {
  const getMyCommunitiesPage$ = vi.fn();
  let unreadSummaryMap$: BehaviorSubject<ReadonlyMap<string, NotificationSummary>>;

  beforeEach(() => {
    vi.clearAllMocks();
    unreadSummaryMap$ = new BehaviorSubject<ReadonlyMap<string, NotificationSummary>>(
      new Map()
    );
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
          useValue: { currentUserSummaryMap$: unreadSummaryMap$ },
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

  it('conecta a orientação de atenção à lista e à paginação sem expor detalhes técnicos', () => {
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
    const headings = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.community-discovery__attention-heading h2'
      )
    ).map((heading) => (heading as HTMLElement).textContent?.trim());

    expect(scope?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      'As comunidades com novidades importantes aparecem primeiro.'
    );
    expect(grid?.getAttribute('aria-describedby')).toBe(
      'community-mine-attention-scope'
    );
    expect(grid?.getAttribute('aria-busy')).toBe('false');
    expect(loadMore?.getAttribute('aria-describedby')).toBe(
      'community-mine-attention-scope'
    );
    expect(loadMore?.getAttribute('aria-busy')).toBe('false');
    expect(headings).toEqual(['Em dia']);
    expect(getMyCommunitiesPage$).toHaveBeenCalledWith({
      limit: 12,
      cursor: null,
      sourceType: 'community',
    });
  });

  it('reagrupa somente itens carregados ao ver mais, elimina duplicata e preserva foco e cursor', async () => {
    unreadSummaryMap$.next(new Map([
      [
        'community-unread',
        {
          communityId: 'community-unread',
          unreadCount: 8,
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
          updatedAt: 300,
        },
      ],
    ]));

    getMyCommunitiesPage$.mockImplementation(
      (request: { cursor: string | null }) => {
        if (request.cursor === null) {
          return of({
            items: [
              communityCard('community-quiet', 'Em dia'),
              communityCard('community-unread', 'Com novidades'),
            ],
            nextCursor: 'cursor-2',
            generatedAt: 123,
          });
        }

        return of({
          items: [
            communityCard('community-unread', 'Com novidades atualizada'),
            communityCard('community-priority', 'Prioritária'),
          ],
          nextCursor: 'cursor-3',
          generatedAt: 456,
        });
      }
    );

    const fixture = TestBed.createComponent(CommunityDiscoveryPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const initialHeadings = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.community-discovery__attention-heading h2'
      )
    ).map((heading) => (heading as HTMLElement).textContent?.trim());
    const loadMore = fixture.nativeElement.querySelector(
      'button[aria-label="Ver mais comunidades"]'
    ) as HTMLButtonElement;

    expect(initialHeadings).toEqual(['Novidades', 'Em dia']);

    loadMore.focus();
    expect(document.activeElement).toBe(loadMore);
    loadMore.click();
    fixture.detectChanges();
    fixture.detectChanges();

    const state = await firstValueFrom(
      fixture.componentInstance.viewState$.pipe(
        filter((value) => value.nextCursor === 'cursor-3'),
        take(1)
      )
    );
    const headings = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.community-discovery__attention-heading h2'
      )
    ).map((heading) => (heading as HTMLElement).textContent?.trim());
    const names = Array.from(
      fixture.nativeElement.querySelectorAll('.community-card--mine h2')
    ).map((heading) => (heading as HTMLElement).textContent?.trim());
    const cards = fixture.nativeElement.querySelectorAll(
      '.community-card--mine'
    ) as NodeListOf<HTMLElement>;
    const nextLoadMore = fixture.nativeElement.querySelector(
      'button[aria-label="Ver mais comunidades"]'
    ) as HTMLButtonElement;

    expect(state.nextCursor).toBe('cursor-3');
    expect(headings).toEqual(['Requer atenção', 'Novidades', 'Em dia']);
    expect(names).toEqual([
      'Prioritária',
      'Com novidades atualizada',
      'Em dia',
    ]);
    expect(cards).toHaveLength(3);
    expect(nextLoadMore).toBe(loadMore);
    expect(document.activeElement).toBe(nextLoadMore);
    expect(getMyCommunitiesPage$).toHaveBeenNthCalledWith(1, {
      limit: 12,
      cursor: null,
      sourceType: 'community',
    });
    expect(getMyCommunitiesPage$).toHaveBeenNthCalledWith(2, {
      limit: 12,
      cursor: 'cursor-2',
      sourceType: 'community',
    });
  });
});