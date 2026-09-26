// src/app/media/photos/boosted-public-photos/boosted-public-photos.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
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
import { PublicPhotoLightboxComponent } from '../../shared/components/public-photo-lightbox/public-photo-lightbox.component';

interface BoostedPhotosViewModel extends PublicPhotoDiscoveryFeedState {
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
  selector: 'app-boosted-public-photos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ContentStateComponent,
    PublicPhotoCardComponent,
    PublicPhotoLightboxComponent,
  ],
  providers: [PublicPhotoDiscoveryFeedService],
  templateUrl: './boosted-public-photos.component.html',
  styleUrls: ['./boosted-public-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoostedPublicPhotosComponent {
  private readonly discovery = inject(PublicPhotoDiscoveryFeedService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly network = inject(NetworkStatusService);

  private readonly selectedIndexSubject =
    new BehaviorSubject<number | null>(null);
  readonly selectedIndex$ = this.selectedIndexSubject.asObservable();

  private readonly loadState$: Observable<PublicPhotoDiscoveryFeedState> =
    this.discovery.connect$('boosted').pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly loadCount$: Observable<number> = this.loadState$.pipe(
    map((state) => state.items.length),
    distinctUntilChanged()
  );

  readonly vm$: Observable<BoostedPhotosViewModel> = combineLatest([
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

  readonly boostedPhotos$: Observable<IPublicPhotoItem[]> = this.vm$.pipe(
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
    this.selectedIndexSubject.next(index);
  }

  closeViewer(): void {
    this.selectedIndexSubject.next(null);
  }

  prev(): void {
    this.boostedPhotos$
      .pipe(take(1))
      .subscribe((items) => {
        const currentIndex = this.selectedIndexSubject.value;
        if (
          currentIndex === null ||
          currentIndex <= 0 ||
          items.length === 0
        ) {
          return;
        }

        this.selectedIndexSubject.next(currentIndex - 1);
      });
  }

  next(): void {
    this.boostedPhotos$
      .pipe(take(1))
      .subscribe((items) => {
        const currentIndex = this.selectedIndexSubject.value;
        if (
          currentIndex === null ||
          currentIndex >= items.length - 1 ||
          items.length === 0
        ) {
          return;
        }

        this.selectedIndexSubject.next(currentIndex + 1);
      });
  }

  trackByPhotoId(_index: number, item: IPublicPhotoItem): string {
    return item.id;
  }
}
