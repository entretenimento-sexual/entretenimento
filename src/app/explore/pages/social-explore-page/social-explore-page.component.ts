import {
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, combineLatest, Observable, of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { PublicPhotoCardComponent } from 'src/app/media/shared/components/public-photo-card/public-photo-card.component';
import { PublicPhotoLightboxComponent } from 'src/app/media/shared/components/public-photo-lightbox/public-photo-lightbox.component';
import { ExploreFeedFacade } from '../../facades/explore-feed.facade';
import { IExploreFeedVm } from '../../services/explore-feed.service';
import { TExploreSectionId } from '../../models/i-explore-section';
import { PhotoViewTrackingService } from 'src/app/core/services/media/photo-view-tracking.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { UserIntentStatusComposerComponent } from 'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { FeedPublicationComposerComponent } from '../../components/feed-publication-composer/feed-publication-composer.component';
import { buildExplorePersonalFeed } from '../../models/explore-personal-feed';
import {
  buildExploreSocialFeed,
  buildExploreSocialFeedWindow,
  ExploreSocialFeedItem,
  ExploreSocialFeedWindow,
} from '../../models/explore-social-feed';
import {
  ExplorePersonalMediaContext,
  ExplorePersonalMediaService,
} from '../../services/explore-personal-media.service';

const FEED_INITIAL_VISIBLE_COUNT = 6;
const FEED_PAGE_SIZE = 6;
const FEED_POOL_LIMIT = 36;
const RELATED_STATUS_LIMIT = 24;

type TExplorePhotoSection =
  | 'feed'
  | Extract<TExploreSectionId, 'boosted' | 'mostViewed' | 'top' | 'latest'>;

type SocialExploreVm = IExploreFeedVm & ExplorePersonalMediaContext;

interface IExploreLightboxState {
  readonly section: TExplorePhotoSection;
  readonly index: number;
}

@Component({
  selector: 'app-social-explore-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PublicPhotoCardComponent,
    PublicPhotoLightboxComponent,
    FeedPublicationComposerComponent,
    UserIntentStatusComposerComponent,
  ],
  templateUrl: './social-explore-page.component.html',
  styleUrls: ['./social-explore-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialExplorePageComponent {
  @ViewChild(FeedPublicationComposerComponent)
  private publicationComposer?: FeedPublicationComposerComponent;

  @ViewChild(UserIntentStatusComposerComponent)
  private statusComposer?: UserIntentStatusComposerComponent;

  private readonly exploreFeedFacade = inject(ExploreFeedFacade);
  private readonly personalMedia = inject(ExplorePersonalMediaService);
  private readonly photoViewTracking = inject(PhotoViewTrackingService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly authSession = inject(AuthSessionService);
  private readonly statusService = inject(UserIntentStatusService);

  private readonly lightboxStateSubject =
    new BehaviorSubject<IExploreLightboxState | null>(null);
  private readonly visibleFeedCountSubject =
    new BehaviorSubject<number>(FEED_INITIAL_VISIBLE_COUNT);

  readonly publicationComposerVisible = signal(false);

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

  readonly currentUser$: Observable<IUserDados | null> =
    this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly authUid$: Observable<string> = this.authSession.readyUid$.pipe(
    map((uid) => String(uid ?? '').trim()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Pool de fotos já priorizado por amizade, compatibilidade e recência.
   * Momentos temporários são inseridos somente depois desse ranking pessoal.
   */
  private readonly photoFeedPool$: Observable<readonly IPublicPhotoItem[]> =
    this.vm$.pipe(
      map((vm) =>
        buildExplorePersonalFeed(vm, {
          limit: FEED_POOL_LIMIT,
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Momentos públicos da região são consultados apenas quando existe algum
   * vínculo pessoal resolvido. O modelo puro faz o filtro final por autor e
   * exclui o próprio usuário, cujo momento ocupa o primeiro cartão da timeline.
   */
  private readonly relatedStatuses$ = combineLatest([
    this.authUid$,
    this.vm$,
  ]).pipe(
    switchMap(([uid, vm]) => {
      const hasPersonalRelations =
        vm.friendUids.length > 0 || vm.compatibleProfiles.length > 0;

      if (!uid || !hasPersonalRelations) {
        return of([]);
      }

      return this.statusService.watchActiveStatusesForUserRegion$(uid, {
        limit: RELATED_STATUS_LIMIT,
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
    ]).pipe(
      map(([photos, statuses, vm, viewerUid]) =>
        buildExploreSocialFeed(
          photos,
          statuses,
          vm.friendUids,
          vm.compatibleProfiles,
          {
            limit: FEED_POOL_LIMIT,
            viewerUid,
          }
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly feedWindow$: Observable<ExploreSocialFeedWindow> = combineLatest([
    this.socialFeedPool$,
    this.visibleFeedCountSubject.pipe(distinctUntilChanged()),
  ]).pipe(
    map(([items, visibleLimit]) =>
      buildExploreSocialFeedWindow(items, visibleLimit)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly feedPhotos$: Observable<readonly IPublicPhotoItem[]> =
    this.feedWindow$.pipe(
      map((window) =>
        window.items
          .filter((item) => item.kind === 'photo')
          .map((item) => item.photo)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly lightboxState$ = this.lightboxStateSubject.asObservable();

  readonly activeLightboxItems$: Observable<readonly IPublicPhotoItem[]> =
    combineLatest([this.lightboxState$, this.vm$, this.feedPhotos$]).pipe(
      map(([state, vm, feedPhotos]) => {
        if (!state) return [];

        switch (state.section) {
          case 'feed':
            return feedPhotos;
          case 'boosted':
            return vm.boostedPhotos;
          case 'mostViewed':
            return vm.mostViewedPhotos;
          case 'top':
            return vm.topPhotos;
          case 'latest':
            return vm.latestPhotos;
          default:
            return [];
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

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
    this.feedPhotos$.pipe(take(1)).subscribe((items) => {
      const index = items.findIndex(
        (item) => item.id === photo.id && item.ownerUid === photo.ownerUid
      );

      if (index >= 0) {
        this.openPhoto('feed', index);
      }
    });
  }

  openPhoto(section: TExplorePhotoSection, index: number): void {
    this.lightboxStateSubject.next({ section, index });

    this.activeLightboxItems$.pipe(take(1)).subscribe((items) => {
      const item = items[index];
      if (!item) return;

      this.photoViewTracking
        .recordPhotoView$(
          item.ownerUid,
          item.id,
          this.resolveViewSource(section)
        )
        .pipe(take(1))
        .subscribe();
    });
  }

  loadMoreFeed(): void {
    this.feedWindow$.pipe(take(1)).subscribe((window) => {
      if (!window.hasMore) return;

      this.visibleFeedCountSubject.next(
        Math.min(window.totalItems, window.visibleCount + FEED_PAGE_SIZE)
      );
    });
  }

  closeViewer(): void {
    this.lightboxStateSubject.next(null);
  }

  prev(): void {
    const state = this.lightboxStateSubject.value;
    if (!state || state.index <= 0) return;

    this.lightboxStateSubject.next({
      ...state,
      index: state.index - 1,
    });
  }

  next(): void {
    const state = this.lightboxStateSubject.value;
    if (!state) return;

    this.activeLightboxItems$.pipe(take(1)).subscribe((items) => {
      if (state.index >= items.length - 1) return;

      this.lightboxStateSubject.next({
        ...state,
        index: state.index + 1,
      });
    });
  }

  trackByFeedItem(_index: number, item: ExploreSocialFeedItem): string {
    return item.key;
  }

  private resolveViewSource(section: TExplorePhotoSection) {
    switch (section) {
      case 'feed':
      case 'mostViewed':
        return 'discover';
      case 'boosted':
        return 'boosted';
      case 'top':
        return 'top';
      case 'latest':
        return 'latest';
      default:
        return 'unknown';
    }
  }
}
