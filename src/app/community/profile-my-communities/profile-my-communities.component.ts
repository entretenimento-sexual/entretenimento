// src/app/community/profile-my-communities/profile-my-communities.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  catchError,
  combineLatest,
  concat,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityNotificationPreferenceService } from 'src/app/core/services/notifications/community-notification-preference.service';
import { CommunityNotificationUnreadSummaryService } from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  CommunityDiscoveryPage,
  CommunityPreviewCard,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';
import {
  CommunityDiscoveryCacheContext,
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
} from '../discovery/community-discovery-cache.model';
import {
  CommunityDiscoveryCacheService,
  CommunityDiscoveryCacheSnapshot,
} from '../discovery/community-discovery-cache.service';

type ProfileMyCommunitiesStatus = 'loading' | 'ready' | 'empty' | 'error';

type ProfileMyCommunityItemVm = CommunityPreviewCard & {
  readonly notificationUnreadCount: number;
  readonly notificationHasPriorityUnread: boolean;
  readonly notificationsMuted: boolean;
};

interface ProfileMyCommunitiesBaseVm {
  readonly status: ProfileMyCommunitiesStatus;
  readonly items: readonly CommunityPreviewCard[];
  readonly stale: boolean;
}

interface ProfileMyCommunitiesVm {
  readonly status: ProfileMyCommunitiesStatus;
  readonly items: readonly ProfileMyCommunityItemVm[];
  readonly stale: boolean;
}

const PROFILE_MY_COMMUNITIES_PAGE_SIZE = 4;

const SUMMARY_CACHE_CONTEXT: CommunityDiscoveryCacheContext = Object.freeze({
  sourceType: 'community',
  discoveryMode: 'mine',
  tagId: null,
  pageSize: PROFILE_MY_COMMUNITIES_PAGE_SIZE,
});

const FULL_CACHE_CONTEXT: CommunityDiscoveryCacheContext = Object.freeze({
  sourceType: 'community',
  discoveryMode: 'mine',
  tagId: null,
  pageSize: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
});

const LOADING_VM: ProfileMyCommunitiesBaseVm = Object.freeze({
  status: 'loading',
  items: [],
  stale: false,
});

const ERROR_VM: ProfileMyCommunitiesBaseVm = Object.freeze({
  status: 'error',
  items: [],
  stale: false,
});

@Component({
  selector: 'app-profile-my-communities',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    ImageFallbackDirective,
    CommunityOfficialBadgeComponent,
  ],
  templateUrl: './profile-my-communities.component.html',
  styleUrl: './profile-my-communities.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileMyCommunitiesComponent {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly unreadSummary = inject(CommunityNotificationUnreadSummaryService);
  private readonly notificationPreference = inject(CommunityNotificationPreferenceService);
  private readonly reloadSubject = new BehaviorSubject<boolean>(false);

  private readonly baseVm$: Observable<ProfileMyCommunitiesBaseVm> =
    this.reloadSubject.pipe(
      switchMap((forceRemote) =>
        forceRemote ? this.fetchRemote$() : this.resolveInitialState$()
      ),
      startWith(LOADING_VM),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly vm$: Observable<ProfileMyCommunitiesVm> = combineLatest([
    this.baseVm$,
    this.unreadSummary.currentUserSummaryMap$,
    this.notificationPreference.currentUserMutedCommunityIds$,
  ]).pipe(
    map(([baseVm, unreadMap, mutedIds]) => ({
      ...baseVm,
      items: baseVm.items.map((item): ProfileMyCommunityItemVm => {
        const summary = unreadMap.get(item.communityId);

        return {
          ...item,
          notificationUnreadCount: summary?.unreadCount ?? 0,
          notificationHasPriorityUnread: summary?.hasPriorityUnread ?? false,
          notificationsMuted: mutedIds.has(item.communityId),
        };
      }),
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.reloadSubject.next(true);
  }

  detailsRoute(item: CommunityPreviewCard): readonly string[] {
    return ['/dashboard/comunidades/minhas', item.communityId];
  }

  membershipRoleLabel(item: CommunityPreviewCard): string | null {
    if (!item.viewerRole) return null;

    const labels: Record<CommunityPreviewViewerRole, string> = {
      owner: 'Proprietário',
      admin: 'Administração',
      moderator: 'Moderação',
      member: 'Membro',
    };

    return labels[item.viewerRole];
  }

  communityInitials(item: CommunityPreviewCard): string {
    return buildCommunityInitials(item);
  }

  communityVisualVariant(item: CommunityPreviewCard): number {
    return resolveCommunityVisualVariant(item);
  }

  private resolveInitialState$(): Observable<ProfileMyCommunitiesBaseVm> {
    return combineLatest([
      this.discoveryCache.readSnapshot$(SUMMARY_CACHE_CONTEXT),
      this.discoveryCache.readSnapshot$(FULL_CACHE_CONTEXT),
    ]).pipe(
      switchMap(([summarySnapshot, fullSnapshot]) => {
        const freshPage = this.latestCompatiblePage(
          summarySnapshot?.fresh ? summarySnapshot : null,
          fullSnapshot?.fresh ? fullSnapshot : null
        );

        if (freshPage) {
          return of(this.toVm(freshPage, false));
        }

        const stalePage = this.latestCompatiblePage(
          summarySnapshot,
          fullSnapshot
        );

        return stalePage
          ? concat(
              of(this.toVm(stalePage, true)),
              this.fetchRemote$(stalePage)
            )
          : this.fetchRemote$();
      })
    );
  }

  private fetchRemote$(
    staleFallback: CommunityDiscoveryPage | null = null
  ): Observable<ProfileMyCommunitiesBaseVm> {
    return this.repository
      .getMyCommunitiesPage$({
        limit: PROFILE_MY_COMMUNITIES_PAGE_SIZE,
        cursor: null,
        sourceType: 'community',
      })
      .pipe(
        tap((page) =>
          this.discoveryCache.rememberPage(
            SUMMARY_CACHE_CONTEXT,
            page,
            false
          )
        ),
        map((page) => this.toVm(page, false)),
        catchError((error: unknown) => {
          this.applicationError.report(error, {
            feature: 'community',
            operation: 'loadProfileMyCommunities',
            fallbackMessage:
              'Não foi possível carregar suas comunidades agora.',
            notification: staleFallback ? 'none' : 'warning',
            metadata: {
              scope: 'ProfileMyCommunitiesComponent',
              pageSize: PROFILE_MY_COMMUNITIES_PAGE_SIZE,
              staleFallback: !!staleFallback,
            },
          });

          return staleFallback ? EMPTY : of(ERROR_VM);
        })
      );
  }

  private latestCompatiblePage(
    summarySnapshot: CommunityDiscoveryCacheSnapshot | null,
    fullSnapshot: CommunityDiscoveryCacheSnapshot | null
  ): CommunityDiscoveryPage | null {
    const candidates = [summarySnapshot, fullSnapshot]
      .filter(
        (snapshot): snapshot is CommunityDiscoveryCacheSnapshot =>
          snapshot !== null
      )
      .map((snapshot) => this.toSummaryPage(snapshot.page))
      .sort((left, right) => right.generatedAt - left.generatedAt);

    return candidates[0] ?? null;
  }

  private toSummaryPage(page: CommunityDiscoveryPage): CommunityDiscoveryPage {
    return {
      items: page.items.slice(0, PROFILE_MY_COMMUNITIES_PAGE_SIZE),
      nextCursor: null,
      generatedAt: page.generatedAt,
    };
  }

  private toVm(
    page: CommunityDiscoveryPage,
    stale: boolean
  ): ProfileMyCommunitiesBaseVm {
    const items = page.items.slice(0, PROFILE_MY_COMMUNITIES_PAGE_SIZE);

    return {
      status: items.length > 0 ? 'ready' : 'empty',
      items,
      stale,
    };
  }
}
