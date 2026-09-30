import { Injectable, signal } from '@angular/core';
import { Observable, EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { PublicMixedMediaViewerLauncherService } from 'src/app/media/shared/services/public-mixed-media-viewer-launcher.service';

@Injectable()
export class SocialExploreMediaViewerFacade {
  readonly openingMediaKey = signal<string | null>(null);
  readonly failedVideoPosterKeys =
    signal<ReadonlySet<string>>(new Set<string>());

  constructor(
    private readonly mixedMediaViewer: PublicMixedMediaViewerLauncherService,
    private readonly errorNotification: ErrorNotificationService,
    private readonly applicationError: ApplicationErrorService
  ) {}

  mediaKey(item: IPublicProfileMediaItem): string {
    return buildPublicMediaIdentity(
      item.mediaType === 'VIDEO' ? 'VIDEO' : 'PHOTO',
      item.ownerUid,
      item.id
    );
  }

  isVideoOpening(item: IPublicVideoItem): boolean {
    return this.openingMediaKey() === this.mediaKey(item);
  }

  hasUsableVideoPoster(item: IPublicVideoItem): boolean {
    const key = this.mediaKey(item);

    return !!key &&
      !!item.posterUrl?.trim() &&
      !this.failedVideoPosterKeys().has(key);
  }

  resetVideoPosterFailures(): void {
    this.failedVideoPosterKeys.set(new Set<string>());
  }

  markVideoPosterFailed(item: IPublicVideoItem): void {
    const key = this.mediaKey(item);

    if (!key || this.failedVideoPosterKeys().has(key)) {
      return;
    }

    this.failedVideoPosterKeys.update((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });

    this.applicationError.report(
      new Error('Falha ao carregar a capa de um vídeo no Explore.'),
      {
        feature: 'explore-media',
        operation: 'loadExploreVideoPoster',
        fallbackMessage: 'Não foi possível carregar a capa deste vídeo.',
        notification: 'none',
        metadata: {
          scope: 'SocialExploreMediaViewerFacade',
          hasOwnerUid: !!item.ownerUid,
          hasVideoId: !!item.id,
        },
      }
    );
  }

  open$(
    requested: IPublicProfileMediaItem,
    sourceItems: readonly IPublicProfileMediaItem[]
  ): Observable<void> {
    const requestedKey = this.mediaKey(requested);

    if (!requestedKey || this.openingMediaKey()) {
      return EMPTY;
    }

    const items = [...sourceItems];
    const selected = items.find(
      (candidate) => this.mediaKey(candidate) === requestedKey
    );

    if (!selected) {
      this.errorNotification.showWarning(
        'Esta publicação não está mais disponível para visitantes.'
      );
      return EMPTY;
    }

    this.openingMediaKey.set(requestedKey);

    return this.mixedMediaViewer.open$({
      items,
      selected,
      source: 'discover',
    }).pipe(
      catchError(() => {
        // O launcher canônico é dono do diagnóstico e da apresentação.
        return EMPTY;
      }),
      finalize(() => {
        if (this.openingMediaKey() === requestedKey) {
          this.openingMediaKey.set(null);
        }
      })
    );
  }
}
