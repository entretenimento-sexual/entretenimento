// src/app/media/photos/top-public-photos/top-public-photos.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Observable, combineLatest } from 'rxjs';
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
import { PublicPhotoViewerStateService } from '../../shared/components/public-photo-lightbox/public-photo-viewer-state.service';

interface TopPhotosViewModel extends PublicPhotoDiscoveryFeedState {
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
    PublicPhotoCardComponent,
    PublicPhotoLightboxComponent,
  ],
  providers: [PublicPhotoDiscoveryFeedService, PublicPhotoViewerStateService],
  templateUrl: './top-public-photos.component.html',
  styleUrls: ['./top-public-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopPublicPhotosComponent {
  private readonly discovery = inject(PublicPhotoDiscoveryFeedService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly network = inject(NetworkStatusService);
  private readonly viewer = inject(PublicPhotoViewerStateService);

  readonly selectedIndex$ = this.viewer.selectedIndex$;

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

    this.discovery.loadMore$().pipe(take(1)).subscribe();
  }

  retry(): void {
    this.discovery.refresh$().pipe(take(1)).subscribe();
  }

  openPhoto(index: number): void {
    this.vm$.pipe(take(1)).subscribe((vm) => {
      this.viewer.open(index, vm.items.length);
    });
  }

  closeViewer(): void {
    this.viewer.close();
  }

  prev(): void {
    this.vm$.pipe(take(1)).subscribe((vm) => {
      this.viewer.previous(vm.items.length);
    });
  }

  next(): void {
    this.vm$.pipe(take(1)).subscribe((vm) => {
      this.viewer.next(vm.items.length);
    });
  }

  trackByPhotoId(_index: number, item: IPublicPhotoItem): string {
    return item.id;
  }
}
