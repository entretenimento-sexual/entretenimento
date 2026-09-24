import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityNotificationUnreadSummaryService } from 'src/app/core/services/notifications/community-notification-unread-summary.service';
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

describe('ExploreCommunityDistributionService', () => {
  let discoveryCalls: ReturnType<typeof vi.fn>;
  let mineCalls: ReturnType<typeof vi.fn>;
  let contentCalls: ReturnType<typeof vi.fn>;
  let unreadMap$: BehaviorSubject<ReadonlyMap<string, any>>;
  let sessionState$: BehaviorSubject<any>;

  beforeEach(() => {
    discoveryCalls = vi.fn(() => of({
      items: [card('a'), card('b'), card('c'), card('d')],
      nextCursor: null,
      generatedAt: 1,
    }));
    mineCalls = vi.fn(() => of({
      items: [card('b'), card('mine-1'), card('mine-2')],
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
    unreadMap$ = new BehaviorSubject<ReadonlyMap<string, any>>(new Map([
      ['mine-1', {
        communityId: 'mine-1',
        unreadCount: 4,
        priorityUnreadCount: 0,
        hasPriorityUnread: false,
        updatedAt: 100,
      }],
      ['mine-2', {
        communityId: 'mine-2',
        unreadCount: 1,
        priorityUnreadCount: 1,
        hasPriorityUnread: true,
        updatedAt: 50,
      }],
    ]));
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
            getMyCommunitiesPage$: mineCalls,
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
          useValue: { currentUserSummaryMap$: unreadMap$.asObservable() },
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

  it('usa apenas páginas agregadas e limita os dois blocos', () => {
    const service = TestBed.inject(ExploreCommunityDistributionService);
    let latest: any;

    const subscription = service.vm$.subscribe((vm) => {
      latest = vm;
    });

    expect(discoveryCalls).toHaveBeenCalledTimes(1);
    expect(mineCalls).toHaveBeenCalledTimes(1);
    expect(latest.recommendations.map((item: any) => item.communityId))
      .toEqual(['d']);
    expect(latest.content.map((item: any) => item.communityId))
      .toEqual(['a']);
    expect(contentCalls).toHaveBeenCalledTimes(1);
    expect(latest.activity.map((item: any) => item.communityId))
      .toEqual(['mine-2', 'mine-1']);

    subscription.unsubscribe();
  });

  it('reage ao resumo agregado sem refazer consultas de Comunidades', () => {
    const service = TestBed.inject(ExploreCommunityDistributionService);
    let latest: any;

    const subscription = service.vm$.subscribe((vm) => {
      latest = vm;
    });

    unreadMap$.next(new Map());

    expect(latest.activity).toEqual([]);
    expect(discoveryCalls).toHaveBeenCalledTimes(1);
    expect(mineCalls).toHaveBeenCalledTimes(1);
    expect(contentCalls).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
  });
});
