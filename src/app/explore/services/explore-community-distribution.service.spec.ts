import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, map, of } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityNotificationUnreadSummary,
  CommunityNotificationUnreadSummaryService,
} from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import { CommunityExploreContentRepository } from 'src/app/community/data-access/community-explore-content.repository';
import { CommunityDiscoveryCacheService } from 'src/app/community/discovery/community-discovery-cache.service';
import { CommunityDiscoverySessionBehaviorService } from 'src/app/community/discovery/community-discovery-session-behavior.service';
import { ExploreCommunityDistributionService } from './explore-community-distribution.service';

function card(id: string) {
  return {
    communityId: id,
    name: `Comunidade ${id}`,
    slug: `comunidade-${id}`,
    description: null,
    source: { type: 'community' as const, id },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 10, postCount: 2, mediaCount: 1 },
    access: {
      join: 'open' as const,
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
  };
}

function summary(
  communityId: string,
  unreadCount: number,
  priorityUnreadCount: number,
  updatedAt: number
): CommunityNotificationUnreadSummary {
  return {
    communityId,
    unreadCount,
    priorityUnreadCount,
    hasPriorityUnread: priorityUnreadCount > 0,
    updatedAt,
  };
}

describe('ExploreCommunityDistributionService', () => {
  let discoveryCalls: ReturnType<typeof vi.fn>;
  let activityCalls: ReturnType<typeof vi.fn>;
  let contentCalls: ReturnType<typeof vi.fn>;
  let unreadSummaries$: BehaviorSubject<
    readonly CommunityNotificationUnreadSummary[]
  >;
  let sessionState$: BehaviorSubject<any>;

  beforeEach(() => {
    discoveryCalls = vi.fn(() => of({
      // O backend de descoberta já remove memberships ativos/pendentes.
      items: [card('a'), card('c'), card('d'), card('e')],
      nextCursor: null,
      generatedAt: 1,
    }));
    activityCalls = vi.fn((communityIds: readonly string[]) => of({
      items: communityIds.map(card),
      nextCursor: null,
      generatedAt: 1,
    }));
    contentCalls = vi.fn(() => of({
      items: [{
        communityId: 'a',
        postId: 'post-a',
        community: {
          name: 'Comunidade a',
          slug: 'comunidade-a',
          avatarUrl: null,
        },
        post: {
          kind: 'text',
          author: { label: 'Autora A', avatarUrl: null },
          text: 'Conteúdo público',
          image: null,
        },
        publishedAt: 1_800_000_000_000,
      }],
      generatedAt: 1_800_000_000_100,
    }));
    unreadSummaries$ = new BehaviorSubject<
      readonly CommunityNotificationUnreadSummary[]
    >([
      summary('mine-1', 4, 0, 100),
      summary('mine-2', 1, 1, 50),
    ]);
    sessionState$ = new BehaviorSubject({
      hiddenCommunityIds: ['c'],
      signals: {},
    });

    TestBed.configureTestingModule({
      providers: [
        ExploreCommunityDistributionService,
        {
          provide: CommunityPreviewRepository,
          useValue: {
            getDiscoveryPage$: discoveryCalls,
            getMyCommunityActivityCards$: activityCalls,
          },
        },
        {
          provide: CommunityExploreContentRepository,
          useValue: {
            getContent$: contentCalls,
          },
        },
        {
          provide: CommunityDiscoveryCacheService,
          useValue: {
            readSnapshot$: vi.fn(() => of(null)),
            rememberPage: vi.fn(),
          },
        },
        {
          provide: CommunityNotificationUnreadSummaryService,
          useValue: {
            currentUserSummaries$: unreadSummaries$.asObservable(),
            currentUserSummaryMap$: unreadSummaries$.pipe(
              map((summaries) => new Map(
                summaries.map((item) => [item.communityId, item] as const)
              ))
            ),
          },
        },
        {
          provide: CommunityDiscoverySessionBehaviorService,
          useValue: { state$: sessionState$.asObservable() },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report: vi.fn() },
        },
      ],
    });
  });

  it('distribui recomendações e atividade sem carregar a página de Minhas', () => {
    const service = TestBed.inject(ExploreCommunityDistributionService);
    let latest: any;

    const subscription = service.vm$.subscribe((vm) => {
      latest = vm;
    });

    expect(discoveryCalls).toHaveBeenCalledTimes(1);
    expect(activityCalls).toHaveBeenCalledTimes(1);
    expect(activityCalls).toHaveBeenCalledWith(['mine-1', 'mine-2']);
    expect(latest.recommendations.map((item: any) => item.communityId))
      .toEqual(['d', 'e']);
    expect(latest.content.map((item: any) => item.communityId))
      .toEqual(['a']);
    expect(contentCalls).toHaveBeenCalledTimes(1);
    expect(latest.activity.map((item: any) => item.communityId))
      .toEqual(['mine-2', 'mine-1']);

    subscription.unsubscribe();
  });

  it('reage a contagens agregadas sem reler cards quando os candidatos não mudam', () => {
    const service = TestBed.inject(ExploreCommunityDistributionService);
    let latest: any;

    const subscription = service.vm$.subscribe((vm) => {
      latest = vm;
    });

    unreadSummaries$.next([
      summary('mine-1', 9, 0, 200),
      summary('mine-2', 2, 1, 50),
    ]);

    expect(activityCalls).toHaveBeenCalledTimes(1);
    expect(latest.activity.map((item: any) => item.communityId))
      .toEqual(['mine-2', 'mine-1']);
    expect(latest.activity.find((item: any) => item.communityId === 'mine-1')
      ?.unreadCount).toBe(9);

    unreadSummaries$.next([]);

    expect(latest.activity).toEqual([]);
    expect(discoveryCalls).toHaveBeenCalledTimes(1);
    expect(activityCalls).toHaveBeenCalledTimes(1);
    expect(contentCalls).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
  });
});
