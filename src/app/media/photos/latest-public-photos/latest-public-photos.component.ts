// src/app/media/photos/latest-public-photos/latest-public-photos.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { EMPTY, Observable, combineLatest } from 'rxjs';
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
import {
  PublicPhotoDiscoveryFeedService,
  PublicPhotoDiscoveryFeedState,
} from 'src/app/core/services/media/public-photo-discovery-feed.service';
import { NetworkStatusService } from 'src/app/core/services/network/network-status.service';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import { PublicPhotoCardComponent } from '../../shared/components/public-photo-card/public-photo-card.component';
import { PhotoPromotionExposureDirective } from '../../shared/directives/photo-promotion-exposure.directive';
import { PhotoPromotionPlacementService } from 'src/app/core/services/media/photo-promotion-placement.service';
import { PublicPhotoViewerLauncherService } from '../photo-viewer/public-photo-viewer-launcher.service';

interface LatestPhotosViewModel extends PublicPhotoDiscoveryFeedState {
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
  selector: 'app-latest-public-photos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ContentStateComponent,
    PublicPhotoCardComponent,
    PhotoPromotionExposureDirective,
  ],
  providers: [PublicPhotoDiscoveryFeedService],
  templateUrl: './latest-public-photos.component.html',
  styleUrls: ['./latest-public-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LatestPublicPhotosComponent {
  private readonly discovery = inject(PublicPhotoDiscoveryFeedService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly network = inject(NetworkStatusService);
  private readonly photoViewer = inject(PublicPhotoViewerLauncherService);
  private readonly promotion = inject(PhotoPromotionPlacementService);

  private readonly loadState$: Observable<PublicPhotoDiscoveryFeedState> =
    this.discovery.connect$('latest').pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly loadCount$: Observable<number> = this.loadState$.pipe(
    map((state) => state.items.length),
    distinctUntilChanged()
  );

  readonly vm$: Observable<LatestPhotosViewModel> = combineLatest([
    this.loadState$,
    this.network.isOffline$,
  ]).pipe(
    map(([state, offline]) => {
      const hasItems = state.items.length > 0;

      return {
        ...state,
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

  readonly latestPhotos$: Observable<IPublicPhotoItem[]> = this.vm$.pipe(
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

    this.discovery.loadMore$().pipe(take(1)).subscribe();
  }

  retry(): void {
    this.discovery.refresh$().pipe(take(1)).subscribe();
  }

  openPhoto(index: number): void {
    this.vm$
      .pipe(
        take(1),
        switchMap((vm) => {
          const selected = vm.items[index];

          if (!selected) {
            this.errorNotifier.showWarning(
              'Esta foto não está mais disponível.'
            );
            return EMPTY;
          }

          return this.photoViewer.open$({
            items: vm.items,
            selected,
            source: 'latest',
          });
        }),
        catchError(() => {
          this.errorNotifier.showError(
            'Não foi possível abrir esta foto recente agora.'
          );
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
            source: 'boosted',
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
