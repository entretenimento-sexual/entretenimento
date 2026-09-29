// src/app/media/photos/top-public-photos/top-public-photos.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, EMPTY, Observable, combineLatest } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import {
  PublicPhotoDiscoveryFeedService,
  PublicPhotoDiscoveryFeedState,
} from 'src/app/core/services/media/public-photo-discovery-feed.service';

import { NetworkStatusService } from 'src/app/core/services/network/network-status.service';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';
import { PublicPhotoCardComponent } from '../../shared/components/public-photo-card/public-photo-card.component';
import { PhotoPromotionExposureDirective } from '../../shared/directives/photo-promotion-exposure.directive';
import { PhotoPromotionPlacementService } from 'src/app/core/services/media/photo-promotion-placement.service';
import { PublicPhotoViewerLauncherService } from '../photo-viewer/public-photo-viewer-launcher.service';

const PHOTO_RENDER_WINDOW_MAX_ITEMS = 72;
const PHOTO_RENDER_WINDOW_STEP = 24;

interface TopPhotosViewModel extends PublicPhotoDiscoveryFeedState {
  renderItems: IPublicPhotoItem[];
  renderStart: number;
  hasEarlierRenderWindow: boolean;
  hasLaterRenderWindow: boolean;
  offline: boolean;
  hasItems: boolean;
  showInitialLoading: boolean;
  showBlockingError: boolean;
  showOfflineEmpty: boolean;
  showEmpty: boolean;
  showStaleNotice: boolean;
  canLoadMore: boolean;
}

@Component({
  selector: 'app-top-public-photos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ContentStateComponent,
    PageHeaderComponent,
    PublicPhotoCardComponent,
    PhotoPromotionExposureDirective,
  ],
  providers: [PublicPhotoDiscoveryFeedService],
  templateUrl: './top-public-photos.component.html',
  styleUrls: ['./top-public-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopPublicPhotosComponent {
  private readonly discovery = inject(PublicPhotoDiscoveryFeedService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly mediaError = inject(MediaApplicationErrorService);
  private readonly network = inject(NetworkStatusService);
  private readonly photoViewer = inject(PublicPhotoViewerLauncherService);
  private readonly promotion = inject(PhotoPromotionPlacementService);
  private readonly renderStartSubject = new BehaviorSubject<number>(0);

  private readonly loadState$: Observable<PublicPhotoDiscoveryFeedState> =
    this.discovery.connect$('top').pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly loadCount$: Observable<number> = this.loadState$.pipe(
    map((state) => state.items.length),
    distinctUntilChanged()
  );

  readonly vm$: Observable<TopPhotosViewModel> = combineLatest([
    this.loadState$,
    this.network.isOffline$,
    this.renderStartSubject,
  ]).pipe(
    map(([state, offline, requestedRenderStart]) => {
      const hasItems = state.items.length > 0;
      const maxRenderStart = Math.max(
        0,
        state.items.length - PHOTO_RENDER_WINDOW_MAX_ITEMS
      );
      const renderStart = Math.max(
        0,
        Math.min(requestedRenderStart, maxRenderStart)
      );
      const renderItems = state.items.slice(
        renderStart,
        renderStart + PHOTO_RENDER_WINDOW_MAX_ITEMS
      );

      return {
        ...state,
        renderItems,
        renderStart,
        hasEarlierRenderWindow: renderStart > 0,
        hasLaterRenderWindow:
          renderStart + renderItems.length < state.items.length,
        offline,
        hasItems,
        showInitialLoading: state.loading && !hasItems,
        showBlockingError: state.error && !offline && !hasItems,
        showOfflineEmpty: offline && !hasItems,
        showEmpty: !state.loading && !state.error && !offline && !hasItems,
        showStaleNotice: hasItems && (state.stale || offline),
        canLoadMore:
          !state.loading &&
          !state.stale &&
          !offline &&
          state.hasMore,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly topPhotos$: Observable<IPublicPhotoItem[]> = this.vm$.pipe(
    map((vm) => vm.items),
    distinctUntilChanged()
  );

  readonly canLoadMore$: Observable<boolean> = this.vm$.pipe(
    map((vm) => vm.canLoadMore),
    distinctUntilChanged()
  );

  loadMore(): void {
    if (!this.network.isOnlineSnapshot()) {
      this.errorNotifier.showWarning(
        'Aguarde a conexão voltar para carregar mais fotos.'
      );
      return;
    }

    this.discovery.loadMore$().pipe(take(1)).subscribe((loaded) => {
      if (!loaded) return;
      this.loadState$.pipe(take(1)).subscribe((state) => {
        this.renderStartSubject.next(
          Math.max(0, state.items.length - PHOTO_RENDER_WINDOW_MAX_ITEMS)
        );
      });
    });
  }

  retry(): void {
    this.renderStartSubject.next(0);
    this.discovery.refresh$().pipe(take(1)).subscribe();
  }

  showEarlierWindow(): void {
    this.renderStartSubject.next(
      Math.max(0, this.renderStartSubject.value - PHOTO_RENDER_WINDOW_STEP)
    );
  }

  showLaterWindow(): void {
    this.loadState$.pipe(take(1)).subscribe((state) => {
      const maxStart = Math.max(
        0,
        state.items.length - PHOTO_RENDER_WINDOW_MAX_ITEMS
      );
      this.renderStartSubject.next(
        Math.min(maxStart, this.renderStartSubject.value + PHOTO_RENDER_WINDOW_STEP)
      );
    });
  }

  openPhoto(selected: IPublicPhotoItem): void {
    this.vm$
      .pipe(
        take(1),
        switchMap((vm) => {
          if (!vm.items.some((item) =>
            item.id === selected.id && item.ownerUid === selected.ownerUid
          )) {
            this.errorNotifier.showWarning(
              'Esta foto não está mais disponível.'
            );
            return EMPTY;
          }

          return this.photoViewer.open$({
            items: vm.items,
            selected,
            source: 'top',
          });
        }),
        catchError((error) => {
          this.mediaError.report(error, {
            operation: 'topPublicPhotos.openPhoto',
            reasonHint: 'photo_discovery_load_failed',
          });
          return EMPTY;
        })
      )
      .subscribe();
  }

  openSponsoredPhoto(): void {
    this.vm$
      .pipe(
        take(1),
        switchMap((vm) => {
          const placement = vm.sponsoredPlacement;
          if (!placement) return EMPTY;

          this.promotion
            .recordEvent$(placement.placementId, 'click')
            .pipe(take(1))
            .subscribe();

          return this.photoViewer.open$({
            items: [placement.photo],
            selected: placement.photo,
            source: 'sponsored',
          });
        }),
        catchError(() => EMPTY)
      )
      .subscribe();
  }

  trackByPhotoId(_index: number, item: IPublicPhotoItem): string {
    return item.id;
  }
}
