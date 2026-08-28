// src/app/media/photos/latest-public-photos/latest-public-photos.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, switchMap, take } from 'rxjs/operators';

import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { PublicPhotoCardComponent } from '../../shared/components/public-photo-card/public-photo-card.component';
import { PublicPhotoLightboxComponent } from '../../shared/components/public-photo-lightbox/public-photo-lightbox.component';

@Component({
  selector: 'app-latest-public-photos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PublicPhotoCardComponent,
    PublicPhotoLightboxComponent,
  ],
  templateUrl: './latest-public-photos.component.html',
  styleUrls: ['./latest-public-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LatestPublicPhotosComponent {
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);

  private readonly pageSize = 24;
  private readonly loadCountSubject = new BehaviorSubject<number>(this.pageSize);
  readonly loadCount$ = this.loadCountSubject.asObservable();

  private readonly selectedIndexSubject = new BehaviorSubject<number | null>(null);
  readonly selectedIndex$ = this.selectedIndexSubject.asObservable();

  readonly latestPhotos$: Observable<IPublicPhotoItem[]> = this.loadCount$.pipe(
    distinctUntilChanged(),
    switchMap((count) => this.mediaPublicQuery.getLatestPublicPhotos$(count)),
    catchError((error: unknown) => {
      this.reportError('Erro ao carregar últimas fotos públicas.', error, {
        op: 'latestPhotos$',
      });
      return of([]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canLoadMore$: Observable<boolean> = this.latestPhotos$.pipe(
    map((items) => items.length >= this.loadCountSubject.value),
    distinctUntilChanged()
  );

  loadMore(): void {
    this.loadCountSubject.next(this.loadCountSubject.value + this.pageSize);
  }

  openPhoto(index: number): void {
    this.selectedIndexSubject.next(index);
  }

  closeViewer(): void {
    this.selectedIndexSubject.next(null);
  }

  prev(): void {
    this.latestPhotos$
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
    this.latestPhotos$
      .pipe(take(1))
      .subscribe((items) => {
        const currentIndex = this.selectedIndexSubject.value;
        if (currentIndex === null || currentIndex >= items.length - 1 || items.length === 0) {
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
        scope: 'LatestPublicPhotosComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}