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
  EMPTY,
  Observable,
} from 'rxjs';
import {
  catchError,
  finalize,
  switchMap,
  take,
} from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import {
  CommunityDistributionTelemetryService,
} from 'src/app/community/discovery/community-distribution-telemetry.service';
import type {
  CommunityDistributionTelemetrySurface,
} from 'src/app/community/data-access/community-distribution-telemetry.repository';
import { CommunityDiscoveryVisibilityDirective } from 'src/app/community/discovery/community-discovery-visibility.directive';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { UserIntentStatusComposerComponent } from 'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { PublicPhotoCardComponent } from 'src/app/media/shared/components/public-photo-card/public-photo-card.component';
import { PublicVideoCardComponent } from 'src/app/media/shared/components/public-video-card/public-video-card.component';
import { PublicMixedMediaViewerLauncherService } from 'src/app/media/shared/services/public-mixed-media-viewer-launcher.service';
import { FeedPublicationComposerComponent } from '../../components/feed-publication-composer/feed-publication-composer.component';
import { ExploreCommunityContentCardComponent } from '../../components/explore-community-content-card/explore-community-content-card.component';
import { ExploreCommunityDistributionService } from '../../services/explore-community-distribution.service';
import { SocialExploreTimelineFacade } from '../../facades/social-explore-timeline.facade';
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
  providers: [SocialExploreTimelineFacade],
})
export class SocialExplorePageComponent {
  @ViewChild(FeedPublicationComposerComponent)
  private publicationComposer?: FeedPublicationComposerComponent;

  @ViewChild(UserIntentStatusComposerComponent)
  private statusComposer?: UserIntentStatusComposerComponent;

  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly timelineFacade = inject(SocialExploreTimelineFacade);
  private readonly mixedMediaViewer = inject(PublicMixedMediaViewerLauncherService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly communityDistribution = inject(ExploreCommunityDistributionService);
  private readonly communityDistributionTelemetry = inject(
    CommunityDistributionTelemetryService
  );

  readonly communityDistribution$ = this.communityDistribution.vm$;

  readonly publicationComposerVisible = signal(false);
  readonly openingMediaKey = signal<string | null>(null);
  readonly failedVideoPosterKeys = signal<ReadonlySet<string>>(new Set<string>());

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
        this.openMediaFromItems$(item, vm.videoHighlights)
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
    this.failedVideoPosterKeys.set(new Set<string>());
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
    return this.mediaKey(item);
  }

  isVideoOpening(item: IPublicVideoItem): boolean {
    return this.openingMediaKey() === this.mediaKey(item);
  }

  hasUsableVideoPoster(item: IPublicVideoItem): boolean {
    const key = this.mediaKey(item);
    return !!key &&
      !!item.posterUrl?.trim() &&
      !this.failedVideoPosterKeys().has(key);
  }

  onVideoPosterError(item: IPublicVideoItem): void {
    const key = this.mediaKey(item);

    if (!key || this.failedVideoPosterKeys().has(key)) {
      return;
    }

    this.failedVideoPosterKeys.update((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });

    this.reportVideoViewerError(
      new Error('Falha ao carregar a capa de um vídeo no Explore.'),
      item,
      'loadExploreVideoPoster'
    );
  }


  private openFeedMedia(requested: IPublicProfileMediaItem): void {
    this.mediaFeedPool$.pipe(
      take(1),
      switchMap((items) => this.openMediaFromItems$(requested, items)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private openMediaFromItems$(
    requested: IPublicProfileMediaItem,
    sourceItems: readonly IPublicProfileMediaItem[]
  ): Observable<void> {
    const requestedKey = this.mediaKey(requested);

    if (!requestedKey || this.openingMediaKey()) {
      return EMPTY;
    }

    const items = [...sourceItems];
    const selected = items.find(
      (candidate) => this.mediaKey(candidate) === requestedKey
    );

    if (!selected) {
      this.errorNotification.showWarning(
        'Esta publicação não está mais disponível para visitantes.'
      );
      return EMPTY;
    }

    this.openingMediaKey.set(requestedKey);

    return this.mixedMediaViewer.open$({
      items,
      selected,
      source: 'discover',
    }).pipe(
      catchError(() => {
        // O launcher canônico é dono do diagnóstico e da apresentação do erro.
        return EMPTY;
      }),
      finalize(() => {
        if (this.openingMediaKey() === requestedKey) {
          this.openingMediaKey.set(null);
        }
      })
    );
  }

  private mediaKey(item: IPublicProfileMediaItem): string {
    return buildPublicMediaIdentity(
      item.mediaType === 'VIDEO' ? 'VIDEO' : 'PHOTO',
      item.ownerUid,
      item.id
    );
  }

  private reportVideoViewerError(
    error: unknown,
    item: IPublicVideoItem,
    operation = 'openExploreVideoViewer'
  ): void {
    this.applicationError.report(error, {
      feature: 'explore-media',
      operation,
      fallbackMessage: 'Não foi possível abrir este vídeo agora.',
      notification: 'none',
      metadata: {
        scope: 'SocialExplorePageComponent',
        hasOwnerUid: !!item.ownerUid,
        hasVideoId: !!item.id,
      },
    });
  }
}
