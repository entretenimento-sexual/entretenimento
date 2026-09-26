import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  combineLatest,
  concat,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs';

import {
  CommunityNotificationUnreadSummary,
  CommunityNotificationUnreadSummaryService,
} from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import { CommunityExploreContentRepository } from 'src/app/community/data-access/community-explore-content.repository';
import type { CommunityExploreContentItem } from 'src/app/community/data-access/community-explore-content.model';
import { getSocialSpaceDefinition } from 'src/app/core/domain/social-space.definition';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityDiscoveryPage,
  CommunityPreviewCard,
} from 'src/app/community/data-access/community-preview.model';
import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import {
  CommunityDiscoveryCacheContext,
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
} from 'src/app/community/discovery/community-discovery-cache.model';
import {
  CommunityDiscoveryCacheService,
} from 'src/app/community/discovery/community-discovery-cache.service';
import { CommunityDiscoverySessionBehaviorService } from 'src/app/community/discovery/community-discovery-session-behavior.service';

export interface ExploreCommunityActivityItem extends CommunityPreviewCard {
  readonly unreadCount: number;
  readonly priorityUnreadCount: number;
  readonly hasPriorityUnread: boolean;
  readonly activityUpdatedAt: number | null;
}

export interface ExploreCommunityDistributionVm {
  readonly recommendations: readonly CommunityPreviewCard[];
  readonly activity: readonly ExploreCommunityActivityItem[];
  readonly content: readonly CommunityExploreContentItem[];
}

const EXPLORE_COMMUNITY_DISTRIBUTION_LIMIT = 3;
const EXPLORE_COMMUNITY_ACTIVITY_CANDIDATE_LIMIT = 6;

const EXPLORE_CACHE_CONTEXT: CommunityDiscoveryCacheContext = Object.freeze({
  sourceType: 'community',
  discoveryMode: 'explore',
  tagId: null,
  pageSize: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
});

function compareActivitySummary(
  left: CommunityNotificationUnreadSummary,
  right: CommunityNotificationUnreadSummary
): number {
  if (left.hasPriorityUnread !== right.hasPriorityUnread) {
    return left.hasPriorityUnread ? -1 : 1;
  }

  const updatedDelta = (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  if (updatedDelta !== 0) return updatedDelta;

  return right.unreadCount - left.unreadCount;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

@Injectable({ providedIn: 'root' })
export class ExploreCommunityDistributionService {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly exploreContentRepository = inject(CommunityExploreContentRepository);
  private readonly cache = inject(CommunityDiscoveryCacheService);
  private readonly unreadSummary = inject(CommunityNotificationUnreadSummaryService);
  private readonly sessionBehavior = inject(CommunityDiscoverySessionBehaviorService);
  private readonly applicationError = inject(ApplicationErrorService);

  private readonly discoveryPage$ = this.resolvePage$(
    EXPLORE_CACHE_CONTEXT,
    () => this.repository.getDiscoveryPage$({
      sourceType: 'community',
      limit: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
      cursor: null,
    }),
    'loadExploreCommunityRecommendations'
  );

  /**
   * O único listener global entrega somente uma janela pequena de atenção.
   * Dela, no máximo seis IDs atravessam a callable; o backend revalida
   * membership + Comunidade em lote e o bloco final continua limitado a três.
   * O custo do Explore não cresce com o total de memberships do usuário.
   */
  private readonly activityCards$ = this.unreadSummary.currentUserSummaries$.pipe(
    map((summaries) =>
      [...summaries]
        .filter((summary) => summary.unreadCount > 0)
        .sort(compareActivitySummary)
        .slice(0, EXPLORE_COMMUNITY_ACTIVITY_CANDIDATE_LIMIT)
        .map((summary) => summary.communityId)
        .sort()
    ),
    distinctUntilChanged(sameStringArray),
    switchMap((communityIds) => {
      if (communityIds.length === 0) {
        return of(this.emptyPage());
      }

      return this.repository.getMyCommunityActivityCards$(communityIds).pipe(
        catchError((error: unknown) => {
          this.applicationError.report(error, {
            feature: 'explore.community-distribution',
            operation: 'loadExploreCommunityActivity',
            fallbackMessage:
              'A atividade das suas Comunidades não pôde ser carregada agora.',
            notification: 'none',
            metadata: {
              scope: 'ExploreCommunityDistributionService',
              candidateCount: communityIds.length,
            },
          });

          return of(this.emptyPage());
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly content$ = this.exploreContentRepository.getContent$(2).pipe(
    catchError((error: unknown) => {
      this.applicationError.report(error, {
        feature: 'explore.community-distribution',
        operation: 'loadExploreCommunityContent',
        fallbackMessage:
          'O conteúdo das Comunidades não pôde ser distribuído no Explorar agora.',
        notification: 'none',
        metadata: {
          scope: 'ExploreCommunityDistributionService',
          contentLimit: 2,
        },
      });

      return of({ items: [], generatedAt: Date.now() });
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$: Observable<ExploreCommunityDistributionVm> = combineLatest([
    this.discoveryPage$,
    this.activityCards$,
    this.unreadSummary.currentUserSummaryMap$,
    this.sessionBehavior.state$,
    this.content$,
  ]).pipe(
    map(([
      discoveryPage,
      activityCards,
      unreadMap,
      sessionState,
      contentPage,
    ]) => {
      const hiddenIds = new Set(sessionState.hiddenCommunityIds);

      const content = contentPage.items
        .filter((item) => !hiddenIds.has(item.communityId))
        .slice(0, 2);
      const contentCommunityIds = new Set(
        content.map((item) => item.communityId)
      );

      // O backend da descoberta já exclui memberships ativos/pendentes em lote.
      // Aqui restam apenas preferências da sessão e deduplicação com conteúdo.
      const recommendations = discoveryPage.items
        .filter(
          (item) =>
            getSocialSpaceDefinition(item.source.type).capabilities.interestDiscovery
            && !hiddenIds.has(item.communityId)
            && !contentCommunityIds.has(item.communityId)
        )
        .slice(0, EXPLORE_COMMUNITY_DISTRIBUTION_LIMIT);

      const activity = activityCards.items
        .flatMap((item): ExploreCommunityActivityItem[] => {
          const summary = unreadMap.get(item.communityId);
          if (!summary || summary.unreadCount <= 0) return [];

          return [{
            ...item,
            unreadCount: summary.unreadCount,
            priorityUnreadCount: summary.priorityUnreadCount,
            hasPriorityUnread: summary.hasPriorityUnread,
            activityUpdatedAt: summary.updatedAt,
          }];
        })
        .sort((left, right) => {
          if (left.hasPriorityUnread !== right.hasPriorityUnread) {
            return left.hasPriorityUnread ? -1 : 1;
          }

          const updatedDelta =
            (right.activityUpdatedAt ?? 0) - (left.activityUpdatedAt ?? 0);
          if (updatedDelta !== 0) return updatedDelta;

          return right.unreadCount - left.unreadCount;
        })
        .slice(0, EXPLORE_COMMUNITY_DISTRIBUTION_LIMIT);

      return { recommendations, activity, content };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private resolvePage$(
    context: CommunityDiscoveryCacheContext,
    fetchRemote: () => Observable<CommunityDiscoveryPage>,
    operation: string
  ): Observable<CommunityDiscoveryPage> {
    return this.cache.readSnapshot$(context).pipe(
      take(1),
      switchMap((snapshot) => {
        if (snapshot?.fresh) {
          return of(snapshot.page);
        }

        const remote$ = fetchRemote().pipe(
          tap((page) => this.cache.rememberPage(context, page, false)),
          catchError((error: unknown) => {
            this.applicationError.report(error, {
              feature: 'explore.community-distribution',
              operation,
              fallbackMessage:
                'As Comunidades não puderam ser distribuídas no Explorar agora.',
              notification: 'none',
              metadata: {
                scope: 'ExploreCommunityDistributionService',
                discoveryMode: context.discoveryMode,
                pageSize: context.pageSize,
                hasStaleFallback: Boolean(snapshot),
              },
            });

            return snapshot ? of(snapshot.page) : of(this.emptyPage());
          })
        );

        return snapshot
          ? concat(of(snapshot.page), remote$)
          : remote$;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private emptyPage(): CommunityDiscoveryPage {
    return {
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    };
  }
}
