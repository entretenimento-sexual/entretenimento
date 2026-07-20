// src/app/media/photos/top-public-photos/top-public-photos.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { GlobalActivityService } from 'src/app/core/services/network/global-activity.service';
import { NetworkStatusService } from 'src/app/core/services/network/network-status.service';
import { retryIdempotentRead } from 'src/app/core/services/network/network-retry.policy';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import { PublicPhotoCardComponent } from '../../shared/components/public-photo-card/public-photo-card.component';
import { PublicPhotoLightboxComponent } from '../../shared/components/public-photo-lightbox/public-photo-lightbox.component';

interface TopPhotosLoadState {
  items: IPublicPhotoItem[];
  loading: boolean;
  error: boolean;
  stale: boolean;
}

interface TopPhotosViewModel extends TopPhotosLoadState {
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
  templateUrl: './top-public-photos.component.html',
  styleUrls: ['./top-public-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopPublicPhotosComponent {
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly network = inject(NetworkStatusService);
  private readonly activity = inject(GlobalActivityService);

  private readonly pageSize = 24;
  private readonly loadCountSubject = new BehaviorSubject<number>(this.pageSize);
  readonly loadCount$ = this.loadCountSubject.asObservable();

  private readonly selectedIndexSubject = new BehaviorSubject<number | null>(null);
  readonly selectedIndex$ = this.selectedIndexSubject.asObservable();

  private lastSuccessfulItems: IPublicPhotoItem[] = [];

  private readonly loadState$: Observable<TopPhotosLoadState> =
    this.loadCount$.pipe(
      distinctUntilChanged(),
      switchMap((count) =>
        this.activity.track$(
          this.mediaPublicQuery.getTopPublicPhotos$(count).pipe(
            retryIdempotentRead({
              maximumRetries: 2,
              isOnline: () => this.network.isOnlineSnapshot(),
            }),
            tap((items) => {
              this.lastSuccessfulItems = items;
            }),
            map((items) => ({
              items,
              loading: false,
              error: false,
              stale: false,
            })),
            catchError((error: unknown) => {
              this.reportError('Erro ao carregar fotos em destaque.', error, {
                op: 'topPhotos$',
              });

              return of({
                items: this.lastSuccessfulItems,
                loading: false,
                error: true,
                stale: this.lastSuccessfulItems.length > 0,
              });
            }),
            startWith({
              items: this.lastSuccessfulItems,
              loading: true,
              error: false,
              stale: this.lastSuccessfulItems.length > 0,
            })
          )
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
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
          !offline &&
          state.items.length >= this.loadCountSubject.value,
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

    this.loadCountSubject.next(this.loadCountSubject.value + this.pageSize);
  }

  retry(): void {
    this.loadCountSubject.next(this.loadCountSubject.value);
  }

  openPhoto(index: number): void {
    this.selectedIndexSubject.next(index);
  }

  closeViewer(): void {
    this.selectedIndexSubject.next(null);
  }

  prev(): void {
    this.topPhotos$
      .pipe(take(1))
      .subscribe((items) => {
        const currentIndex = this.selectedIndexSubject.value;
        if (currentIndex === null || currentIndex <= 0 || items.length === 0) {
          return;
        }

        this.selectedIndexSubject.next(currentIndex - 1);
      });
  }

  next(): void {
    this.topPhotos$
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

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'TopPublicPhotosComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}
