// src/app/media/photos/public-profile-photos/public-profile-photos.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { PublicPhotoCardComponent } from '../../shared/components/public-photo-card/public-photo-card.component';
import { PublicPhotoLightboxComponent } from '../../shared/components/public-photo-lightbox/public-photo-lightbox.component';


@Component({
  selector: 'app-public-profile-photos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PublicPhotoCardComponent,
    PublicPhotoLightboxComponent,
  ],
  templateUrl: './public-profile-photos.component.html',
  styleUrls: ['./public-profile-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicProfilePhotosComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);

  private readonly selectedIndexSubject = new BehaviorSubject<number | null>(null);
  readonly selectedIndex$ = this.selectedIndexSubject.asObservable();

  private readonly DEBUG = true;

  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((params) => (params.get('id') ?? '').trim()),
    distinctUntilChanged(),
    tap((ownerUid) => this.debug('ownerUid$', ownerUid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly publicPhotos$: Observable<IPublicPhotoItem[]> = this.ownerUid$.pipe(
    switchMap((ownerUid) => {
      if (!ownerUid) {
        return of([] as IPublicPhotoItem[]);
      }

      return this.mediaPublicQuery.getProfilePublicPhotos$(ownerUid);
    }),
    catchError((error: unknown) => {
      this.reportError(
        'Erro ao carregar a galeria pública do perfil.',
        error,
        { op: 'publicPhotos$' }
      );
      return of([] as IPublicPhotoItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isEmpty$: Observable<boolean> = this.publicPhotos$.pipe(
    map((items) => items.length === 0),
    distinctUntilChanged()
  );

  openPhoto(index: number): void {
    this.selectedIndexSubject.next(index);
  }

  closeViewer(): void {
    this.selectedIndexSubject.next(null);
  }

  prev(): void {
    this.publicPhotos$
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
    this.publicPhotos$
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
        scope: 'PublicProfilePhotosComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }

    this.debug('reportError', { userMessage, context, error });
  }

  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[PublicProfilePhotos] ${msg}`, data ?? '');
  }
}