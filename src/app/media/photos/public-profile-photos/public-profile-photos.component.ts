// src/app/media/photos/public-profile-photos/public-profile-photos.component.ts
// Galeria pública de fotos do perfil.
//
// Ajustes desta versão:
// - mantém leitura somente da projeção pública;
// - transforma a página em galeria real, não foto gigante;
// - abre PhotoViewerComponent para reações, comentários, respostas e views;
// - mantém Observable e tratamento centralizado de erro.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { Observable, of } from 'rxjs';
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
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';

import {
  IProfilePhotoItem,
  PhotoViewerComponent,
} from '../photo-viewer/photo-viewer.component';
import { PublicPhotoCardComponent } from '../../shared/components/public-photo-card/public-photo-card.component';

@Component({
  selector: 'app-public-profile-photos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatDialogModule,
    PublicPhotoCardComponent,
  ],
  templateUrl: './public-profile-photos.component.html',
  styleUrls: ['./public-profile-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicProfilePhotosComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
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
    this.publicPhotos$
      .pipe(take(1))
      .subscribe((items) => {
        if (!items.length) {
          this.errorNotifier.showWarning('Nenhuma foto pública disponível.');
          return;
        }

        const safeIndex = Math.max(0, Math.min(index, items.length - 1));
        const viewerItems = items.map((item) => this.toViewerPhotoItem(item));
        const selected = viewerItems[safeIndex];

        this.dialog.open(PhotoViewerComponent, {
          data: {
            ownerUid: selected?.ownerUid ?? '',
            items: viewerItems,
            startIndex: safeIndex,
            source: 'profile',
          },
          autoFocus: false,
          restoreFocus: true,
          width: '100vw',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
          panelClass: ['photo-viewer-dialog', 'photo-viewer-dialog--immersive'],
          backdropClass: 'photo-viewer-backdrop',
        });
      });
  }

  trackByPhotoId(_index: number, item: IPublicPhotoItem): string {
    return item.id;
  }

  private toViewerPhotoItem(item: IPublicPhotoItem): IProfilePhotoItem {
    return {
      id: item.id,
      ownerUid: item.ownerUid,
      url: item.url,
      alt: item.alt,
      createdAt: item.createdAt,

      commentsEnabled: item.commentsEnabled ?? false,
      commentsPolicy: item.commentsPolicy ?? 'OFF',
      reactionsEnabled: item.reactionsEnabled ?? false,
      moderationStatus: item.moderationStatus ?? 'PRIVATE',
    };
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

    this.debug('reportError', {
      userMessage,
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
