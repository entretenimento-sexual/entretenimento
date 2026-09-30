import { Injectable } from '@angular/core';
import { BehaviorSubject, EMPTY, Observable, combineLatest, of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import { ExploreFeedFacade } from './explore-feed.facade';
import { buildExplorePersonalFeed } from '../models/explore-personal-feed';
import {
  buildExploreSocialFeed,
  buildExploreSocialFeedWindow,
  ExploreSocialFeedItem,
  ExploreSocialFeedWindow,
} from '../models/explore-social-feed';
import {
  ExplorePersonalMediaContext,
  ExplorePersonalMediaService,
} from '../services/explore-personal-media.service';
import { IExploreFeedVm } from '../services/explore-feed.service';

const FEED_INITIAL_VISIBLE_COUNT = 6;
const FEED_PAGE_SIZE = 6;
const FEED_POOL_LIMIT = 36;
const RELATED_STATUS_LIMIT = 24;

export type SocialExploreVm = IExploreFeedVm & ExplorePersonalMediaContext & {
  readonly compatibleOwnerUids?: readonly string[];
  readonly hasMorePersonalMedia?: boolean;
  readonly loadingMorePersonalMedia?: boolean;
  readonly loadingInitialPersonalMedia?: boolean;
  readonly personalMediaLoadFailed?: boolean;
};

export interface SocialExploreFeedWindow extends ExploreSocialFeedWindow {
  readonly hasBackendMore: boolean;
  readonly loadingMore: boolean;
}

@Injectable()
export class SocialExploreTimelineFacade {
  private readonly visibleFeedCountSubject =
    new BehaviorSubject<number>(FEED_INITIAL_VISIBLE_COUNT);

  readonly vm$: Observable<SocialExploreVm> = combineLatest([
    this.exploreFeedFacade.vm$,
    this.personalMedia.context$,
  ]).pipe(
    map(([vm, personal]) => ({
      ...vm,
      ...personal,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly authUid$: Observable<string> = this.authSession.readyUid$.pipe(
    map((uid) => String(uid ?? '').trim()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly compatibleProfiles$ =
    this.compatibleCandidates.profiles$.pipe(
      map((profiles) => [...profiles]),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly photoFeedPool$: Observable<readonly IPublicPhotoItem[]> =
    combineLatest([
      this.vm$,
      this.compatibleProfiles$,
    ]).pipe(
      map(([vm, compatibleProfiles]) => {
        const candidateCount =
          vm.personalPhotos.length +
          vm.latestPhotos.length +
          vm.topPhotos.length +
          vm.mostViewedPhotos.length;

        return buildExplorePersonalFeed(
          {
            ...vm,
            compatibleProfiles,
            compatibleOwnerUids: vm.compatibleOwnerUids ?? [],
          },
          {
            limit: Math.max(FEED_POOL_LIMIT, candidateCount),
          }
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly relatedStatuses$ = combineLatest([
    this.authUid$,
    this.vm$,
    this.compatibleProfiles$,
  ]).pipe(
    switchMap(([uid, vm, compatibleProfiles]) => {
      if (!uid) {
        return of([]);
      }

      const relatedOwnerUids = new Set<string>();

      for (const friendUid of vm.friendUids) {
        const normalizedUid = String(friendUid ?? '').trim();
        if (normalizedUid && normalizedUid !== uid) {
          relatedOwnerUids.add(normalizedUid);
        }
      }

      for (const profile of compatibleProfiles) {
        const normalizedUid = String(profile?.uid ?? '').trim();
        if (normalizedUid && normalizedUid !== uid) {
          relatedOwnerUids.add(normalizedUid);
        }
      }

      for (const compatibleUid of vm.compatibleOwnerUids ?? []) {
        const normalizedUid = String(compatibleUid ?? '').trim();
        if (normalizedUid && normalizedUid !== uid) {
          relatedOwnerUids.add(normalizedUid);
        }
      }

      if (!relatedOwnerUids.size) {
        return of([]);
      }

      return this.statusService.watchActiveStatusesForUserRegion$(uid, {
        limit: RELATED_STATUS_LIMIT,
        ownerUids: [...relatedOwnerUids],
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly socialFeedPool$: Observable<readonly ExploreSocialFeedItem[]> =
    combineLatest([
      this.photoFeedPool$,
      this.relatedStatuses$,
      this.vm$,
      this.authUid$,
      this.compatibleProfiles$,
    ]).pipe(
      map(([photos, statuses, vm, viewerUid, compatibleProfiles]) =>
        buildExploreSocialFeed(
          photos,
          statuses,
          vm.friendUids,
          compatibleProfiles,
          {
            limit: Math.max(
              FEED_POOL_LIMIT,
              photos.length + vm.personalVideos.length + statuses.length
            ),
            viewerUid,
            videos: vm.personalVideos,
            compatibleOwnerUids: vm.compatibleOwnerUids ?? [],
          }
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly mediaFeedPool$: Observable<readonly IPublicProfileMediaItem[]> =
    this.socialFeedPool$.pipe(
      map((items) =>
        items.flatMap((item): IPublicProfileMediaItem[] => {
          if (item.kind === 'photo') return [item.photo];
          if (item.kind === 'video') return [item.video];
          return [];
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly feedWindow$: Observable<SocialExploreFeedWindow> = combineLatest([
    this.socialFeedPool$,
    this.visibleFeedCountSubject.pipe(distinctUntilChanged()),
    this.vm$,
  ]).pipe(
    map(([items, visibleLimit, vm]) => {
      const localWindow = buildExploreSocialFeedWindow(items, visibleLimit);
      const hasBackendMore = vm.hasMorePersonalMedia === true;

      return {
        ...localWindow,
        hasBackendMore,
        loadingMore: vm.loadingMorePersonalMedia === true,
        hasMore: localWindow.hasMore || hasBackendMore,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly exploreFeedFacade: ExploreFeedFacade,
    private readonly personalMedia: ExplorePersonalMediaService,
    private readonly compatibleCandidates: CompatibleProfileCandidatesService,
    private readonly authSession: AuthSessionService,
    private readonly statusService: UserIntentStatusService
  ) {}

  retryVideoHighlights(): void {
    this.exploreFeedFacade.retryVideoHighlights();
  }

  loadMore$(): Observable<void> {
    return this.feedWindow$.pipe(
      take(1),
      switchMap((window) => {
        if (window.loadingMore || !window.hasMore) {
          return EMPTY;
        }

        if (window.remainingItems > 0) {
          this.visibleFeedCountSubject.next(
            Math.min(window.totalItems, window.visibleCount + FEED_PAGE_SIZE)
          );
          return of(void 0);
        }

        if (!window.hasBackendMore) {
          return EMPTY;
        }

        return this.loadMorePersonalMedia$().pipe(
          switchMap((loaded) =>
            loaded ? this.feedWindow$.pipe(take(1)) : EMPTY
          ),
          map((updatedWindow) => {
            this.visibleFeedCountSubject.next(
              Math.min(
                updatedWindow.totalItems,
                window.visibleCount + FEED_PAGE_SIZE
              )
            );
            return void 0;
          })
        );
      })
    );
  }

  private loadMorePersonalMedia$(): Observable<boolean> {
    const paginatedSource = this.personalMedia as ExplorePersonalMediaService & {
      loadMore$?: () => Observable<boolean>;
    };

    return typeof paginatedSource.loadMore$ === 'function'
      ? paginatedSource.loadMore$()
      : of(false);
  }
}
