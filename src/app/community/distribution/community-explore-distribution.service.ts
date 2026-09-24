// src/app/community/distribution/community-explore-distribution.service.ts
import { Injectable, inject } from '@angular/core';
import {
  EMPTY,
  Observable,
  catchError,
  combineLatest,
  concat,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityNotificationUnreadSummaryService,
} from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import {
  CommunityPreviewCard,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import {
  CommunityDiscoveryCacheContext,
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
} from '../discovery/community-discovery-cache.model';
import { CommunityDiscoveryCacheService } from '../discovery/community-discovery-cache.service';
import { CommunityDiscoveryExposureService } from '../discovery/community-discovery-exposure.service';
import { CommunityDiscoverySessionBehaviorService } from '../discovery/community-discovery-session-behavior.service';

const EXPLORE_RECOMMENDATION_LIMIT = 4;
const MAX_ACTIVITY_COUNT = 1_000_000_000;

export interface CommunityExploreActivitySummary {
  readonly unreadCount: number;
  readonly communityCount: number;
  readonly priorityCommunityCount: number;
  readonly hasPriorityUnread: boolean;
  readonly latestUpdatedAt: number | null;
}

export interface CommunityExploreDistributionVm {
  readonly activity: CommunityExploreActivitySummary;
  readonly recommendations: readonly CommunityPreviewCard[];
}

const EMPTY_ACTIVITY: CommunityExploreActivitySummary = Object.freeze({
  unreadCount: 0,
  communityCount: 0,
  priorityCommunityCount: 0,
  hasPriorityUnread: false,
  latestUpdatedAt: null,
});

@Injectable({ providedIn: 'root' })
export class CommunityExploreDistributionService {
  private readonly session = inject(AuthSessionService);
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);
  private readonly unreadSummary = inject(
    CommunityNotificationUnreadSummaryService
  );
  private readonly sessionBehavior = inject(
    CommunityDiscoverySessionBehaviorService
  );
  private readonly exposure = inject(CommunityDiscoveryExposureService);
  private readonly applicationError = inject(ApplicationErrorService);

  private readonly cacheContext: CommunityDiscoveryCacheContext = Object.freeze({
    sourceType: 'community',
    discoveryMode: 'explore',
    tagId: null,
    pageSize: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
    excludeActiveMemberships: true,
  });

  readonly activity$: Observable<CommunityExploreActivitySummary> =
    this.unreadSummary.currentUserSummaries$.pipe(
      map((summaries) => {
        if (!summaries.length) return EMPTY_ACTIVITY;

        let unreadCount = 0;
        let priorityCommunityCount = 0;
        let latestUpdatedAt: number | null = null;

        for (const summary of summaries) {
          unreadCount = Math.min(
            MAX_ACTIVITY_COUNT,
            unreadCount + summary.unreadCount
          );

          if (summary.hasPriorityUnread) {
            priorityCommunityCount += 1;
          }

          if (
            summary.updatedAt !== null
            && (latestUpdatedAt === null || summary.updatedAt > latestUpdatedAt)
          ) {
            latestUpdatedAt = summary.updatedAt;
          }
        }

        return {
          unreadCount,
          communityCount: summaries.length,
          priorityCommunityCount,
          hasPriorityUnread: priorityCommunityCount > 0,
          latestUpdatedAt,
        };
      }),
      distinctUntilChanged(
        (previous, current) =>
          previous.unreadCount === current.unreadCount
          && previous.communityCount === current.communityCount
          && previous.priorityCommunityCount === current.priorityCommunityCount
          && previous.latestUpdatedAt === current.latestUpdatedAt
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly recommendationPool$: Observable<
    readonly CommunityPreviewCard[]
  > = this.session.readyUid$.pipe(
    map((uid) => String(uid ?? '').trim()),
    distinctUntilChanged(),
    switchMap((uid) =>
      uid ? this.resolveRecommendationPool$() : of([])
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly recommendations$: Observable<readonly CommunityPreviewCard[]> =
    combineLatest([
      this.recommendationPool$,
      this.sessionBehavior.state$,
    ]).pipe(
      map(([items, sessionState]) => {
        const hidden = new Set(sessionState.hiddenCommunityIds);

        return items
          .filter(
            (item) =>
              item.source.type === 'community'
              && !hidden.has(item.communityId)
          )
          .slice(0, EXPLORE_RECOMMENDATION_LIMIT);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  hideRecommendation(communityIdValue: string): void {
    const communityId = String(communityIdValue ?? '').trim();
    if (!communityId) return;

    this.sessionBehavior.hideCommunity(communityId);
  }

  recordQualifiedExposure(communityIdValue: string): void {
    const communityId = String(communityIdValue ?? '').trim();
    if (!communityId) return;

    this.exposure.recordQualifiedExposure(communityId, 'community');
  }

  private resolveRecommendationPool$(): Observable<
    readonly CommunityPreviewCard[]
  > {
    return this.discoveryCache.readSnapshot$(this.cacheContext).pipe(
      switchMap((snapshot) => {
        const cachedItems = snapshot?.page.items ?? [];

        if (snapshot?.fresh) {
          return of(cachedItems);
        }

        const refresh$ = this.repository.getDiscoveryPage$({
          limit: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
          sourceType: 'community',
          tagId: null,
          cursor: null,
          excludeActiveMemberships: true,
        }).pipe(
          tap((page) =>
            this.discoveryCache.rememberPage(
              this.cacheContext,
              page,
              false
            )
          ),
          map((page) => page.items),
          catchError((error: unknown) => {
            this.applicationError.report(error, {
              feature: 'community',
              operation: 'loadExploreCommunityRecommendations',
              fallbackMessage:
                'As recomendações de Comunidades não puderam ser atualizadas agora.',
              notification: 'none',
              metadata: {
                scope: 'CommunityExploreDistributionService',
                surface: 'social-explore',
              },
            });

            return snapshot ? EMPTY : of<readonly CommunityPreviewCard[]>([]);
          })
        );

        return snapshot
          ? concat(of(cachedItems), refresh$)
          : refresh$;
      })
    );
  }
}
