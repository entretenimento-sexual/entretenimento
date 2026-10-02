// src/app/media/photos/public-profile-photos/public-profile-photos.component.ts
// Galeria pública de fotos do perfil.
//
// Ajustes desta versão:
// - mantém leitura somente da projeção pública;
// - transforma a página em galeria real, não foto gigante;
// - abre o viewer pela porta canônica pública;
// - mantém Observable e tratamento centralizado de erro.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import {
  BehaviorSubject,
  EMPTY,
  Observable,
  combineLatest,
  of,
} from 'rxjs';
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

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import type { MediaErrorReason } from 'src/app/core/services/media/media-error.catalog';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';

import { PublicPhotoViewerLauncherService } from '../photo-viewer/public-photo-viewer-launcher.service';
import { PublicPhotoCardComponent } from '../../shared/components/public-photo-card/public-photo-card.component';

interface PublicProfilePhotosState {
  readonly status: 'loading' | 'ready' | 'empty' | 'error';
  readonly items: readonly IPublicPhotoItem[];
}

@Component({
  selector: 'app-public-profile-photos',
  standalone: true,
  imports: [
    CommonModule,
    PublicPhotoCardComponent,
    ContentStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './public-profile-photos.component.html',
  styleUrls: ['./public-profile-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicProfilePhotosComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly photoViewerLauncher = inject(PublicPhotoViewerLauncherService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(MediaApplicationErrorService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  private readonly DEBUG = false;

  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((params) => (params.get('id') ?? '').trim()),
    distinctUntilChanged(),
    tap((ownerUid) =>
      this.debug('ownerUid$', {
        hasOwnerUid: !!ownerUid,
      })
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly refreshSubject = new BehaviorSubject<number>(0);

  readonly state$: Observable<PublicProfilePhotosState> = combineLatest([
    this.ownerUid$,
    this.refreshSubject,
  ]).pipe(
    switchMap(([ownerUid]) => {
      if (!ownerUid) {
        return of<PublicProfilePhotosState>({
          status: 'empty',
          items: [],
        });
      }

      return this.mediaPublicQuery.getProfilePublicPhotos$(ownerUid).pipe(
        map((items): PublicProfilePhotosState => ({
          status: items.length > 0 ? 'ready' : 'empty',
          items,
        })),
        startWith<PublicProfilePhotosState>({
          status: 'loading',
          items: [],
        }),
        catchError((error: unknown) => {
          this.reportError(
            'media_discovery_load_failed',
            error,
            { op: 'publicPhotos$' }
          );

          return of<PublicProfilePhotosState>({
            status: 'error',
            items: [],
          });
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly publicPhotos$: Observable<IPublicPhotoItem[]> = this.state$.pipe(
    map((state) => [...state.items]),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  openPhoto(index: number): void {
    this.publicPhotos$
      .pipe(
        take(1),
        switchMap((items) => {
          if (!items.length) {
            this.errorNotifier.showWarning('Nenhuma foto pública disponível.');
            return EMPTY;
          }

          const safeIndex = Math.max(0, Math.min(index, items.length - 1));
          const selected = items[safeIndex];

          if (!selected) {
            this.errorNotifier.showWarning('Esta foto não está mais disponível.');
            return EMPTY;
          }

          return this.photoViewerLauncher.open$({
            items,
            selected,
            source: 'profile',
          });
        }),
        catchError((error: unknown) => {
          this.reportError(
            'media_navigation_failed',
            error,
            { op: 'openPhoto' }
          );
          return EMPTY;
        })
      )
      .subscribe();
  }

  trackByPhotoId(_index: number, item: IPublicPhotoItem): string {
    return item.id;
  }

  private reportError(
    reasonHint: MediaErrorReason,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    this.errorHandler.report(error, {
      operation: String(context?.['op'] ?? 'unknown'),
      reasonHint,
      metadata: {
        scope: 'PublicProfilePhotosComponent',
        ...(context ?? {}),
      },
    });

    this.debug('reportError', {
      reasonHint,
      op: context?.['op'] ?? 'unknown',
      hasContext: !!context,
      errorMessage: error instanceof Error ? error.message : String(error ?? ''),
    });
  }

  private debug(message: string, extra?: unknown): void {
    if (!this.DEBUG) return;
    this.privacyDebug.log('media', `PublicProfilePhotos: ${message}`, extra);
  }
}
