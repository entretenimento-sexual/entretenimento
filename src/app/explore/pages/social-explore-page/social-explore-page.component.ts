import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import {
  Observable,
} from 'rxjs';
import {
  switchMap,
  take,
} from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import {
  CommunityDistributionTelemetryService,
} from 'src/app/community/discovery/community-distribution-telemetry.service';
import type {
  CommunityDistributionTelemetrySurface,
} from 'src/app/community/data-access/community-distribution-telemetry.repository';
import { CommunityDiscoveryVisibilityDirective } from 'src/app/community/discovery/community-discovery-visibility.directive';
import { UserIntentStatusComposerComponent } from 'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { PublicPhotoCardComponent } from 'src/app/media/shared/components/public-photo-card/public-photo-card.component';
import { PublicVideoCardComponent } from 'src/app/media/shared/components/public-video-card/public-video-card.component';
import { FeedPublicationComposerComponent } from '../../components/feed-publication-composer/feed-publication-composer.component';
import { ExploreCommunityContentCardComponent } from '../../components/explore-community-content-card/explore-community-content-card.component';
import { ExploreCommunityDistributionService } from '../../services/explore-community-distribution.service';
import { SocialExploreTimelineFacade } from '../../facades/social-explore-timeline.facade';
import { SocialExploreMediaViewerFacade } from '../../facades/social-explore-media-viewer.facade';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import { ExploreSocialFeedItem } from '../../models/explore-social-feed';

@Component({
  selector: 'app-social-explore-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PublicPhotoCardComponent,
    PublicVideoCardComponent,
    FeedPublicationComposerComponent,
    UserIntentStatusComposerComponent,
    CommunityDiscoveryVisibilityDirective,
    ExploreCommunityContentCardComponent,
    ContentStateComponent,
  ],
  templateUrl: './social-explore-page.component.html',
  styleUrls: ['./social-explore-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SocialExploreTimelineFacade, SocialExploreMediaViewerFacade],
})
export class SocialExplorePageComponent {
  @ViewChild(FeedPublicationComposerComponent)
  private publicationComposer?: FeedPublicationComposerComponent;

  @ViewChild(UserIntentStatusComposerComponent)
  private statusComposer?: UserIntentStatusComposerComponent;

  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly timelineFacade = inject(SocialExploreTimelineFacade);
  private readonly mediaViewerFacade = inject(SocialExploreMediaViewerFacade);
  private readonly communityDistribution = inject(ExploreCommunityDistributionService);
  private readonly communityDistributionTelemetry = inject(
    CommunityDistributionTelemetryService
  );

  readonly communityDistribution$ = this.communityDistribution.vm$;

  readonly publicationComposerVisible = signal(false);

  readonly vm$ = this.timelineFacade.vm$;
  readonly authUid$ = this.timelineFacade.authUid$;
  readonly feedWindow$ = this.timelineFacade.feedWindow$;
  private readonly mediaFeedPool$ = this.timelineFacade.mediaFeedPool$;

  readonly currentUser$: Observable<IUserDados | null> =
    this.currentUserStore.user$;

  openPublicationComposer(openFilePicker = false): void {
    this.statusComposer?.closeComposer();
    this.publicationComposerVisible.set(true);

    if (openFilePicker) {
      queueMicrotask(() => this.publicationComposer?.openFilePicker());
    }
  }

  closePublicationComposer(): void {
    this.publicationComposerVisible.set(false);
  }

  onPublicationPublished(): void {
    this.publicationComposerVisible.set(false);
  }

  openFeedPhoto(photo: IPublicPhotoItem): void {
    this.openFeedMedia(photo);
  }

  openVideoHighlight(item: IPublicVideoItem): void {
    this.vm$.pipe(
      take(1),
      switchMap((vm) =>
        this.mediaViewerFacade.open$(item, vm.videoHighlights)
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  openFeedVideo(item: IPublicVideoItem): void {
    this.openFeedMedia(item);
  }

  recordCommunityDistributionExposure(
    communityId: string,
    surface: CommunityDistributionTelemetrySurface
  ): void {
    this.communityDistributionTelemetry.recordQualifiedExposure(
      communityId,
      surface
    );
  }

  recordCommunityDistributionOpen(
    communityId: string,
    surface: CommunityDistributionTelemetrySurface
  ): void {
    this.communityDistributionTelemetry.recordOpen(communityId, surface);
  }

  communityInitials(name: string): string {
    return String(name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join('') || '?';
  }

  retryVideoHighlights(): void {
    this.mediaViewerFacade.resetVideoPosterFailures();
    this.timelineFacade.retryVideoHighlights();
  }

  loadMoreFeed(): void {
    this.timelineFacade
      .loadMore$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  trackByFeedItem(_index: number, item: ExploreSocialFeedItem): string {
    return item.key;
  }

  trackByVideoId(_index: number, item: IPublicVideoItem): string {
    return this.mediaViewerFacade.mediaKey(item);
  }

  isVideoOpening(item: IPublicVideoItem): boolean {
    return this.mediaViewerFacade.isVideoOpening(item);
  }

  hasUsableVideoPoster(item: IPublicVideoItem): boolean {
    return this.mediaViewerFacade.hasUsableVideoPoster(item);
  }

  onVideoPosterError(item: IPublicVideoItem): void {
    this.mediaViewerFacade.markVideoPosterFailed(item);
  }


  private openFeedMedia(requested: IPublicPhotoItem | IPublicVideoItem): void {
    this.mediaFeedPool$
      .pipe(
        take(1),
        switchMap((items) => this.mediaViewerFacade.open$(requested, items)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }


}
