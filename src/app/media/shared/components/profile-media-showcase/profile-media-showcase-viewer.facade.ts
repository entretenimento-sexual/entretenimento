import { Injectable, signal } from '@angular/core';
import { Observable, EMPTY } from 'rxjs';
import { catchError, finalize, switchMap, take } from 'rxjs/operators';

import { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { MediaPublicPreviewQueryService } from 'src/app/core/services/media/media-public-preview-query.service';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { PublicMixedMediaViewerLauncherService } from '../../services/public-mixed-media-viewer-launcher.service';

const SHOWCASE_ITEM_LIMIT = 5;

@Injectable()
export class ProfileMediaShowcaseViewerFacade {
  readonly opening = signal(false);

  constructor(
    private readonly mediaPublicPreview: MediaPublicPreviewQueryService,
    private readonly mixedViewerLauncher: PublicMixedMediaViewerLauncherService,
    private readonly errorNotification: ErrorNotificationService,
    private readonly mediaError: MediaApplicationErrorService
  ) {}

  identity(item: IPublicProfileMediaItem): string {
    return buildPublicMediaIdentity(
      item.mediaType === 'VIDEO' ? 'VIDEO' : 'PHOTO',
      item.ownerUid,
      item.id
    );
  }

  open$(
    ownerUid: string,
    requested: IPublicProfileMediaItem,
    fallbackIndex: number
  ): Observable<void> {
    const safeOwnerUid = String(ownerUid ?? '').trim();
    const requestedIdentity = this.identity(requested);

    if (!safeOwnerUid || !requestedIdentity || this.opening()) {
      return EMPTY;
    }

    this.opening.set(true);

    return this.mediaPublicPreview
      .getProfilePublicMediaPreview$(
        safeOwnerUid,
        SHOWCASE_ITEM_LIMIT,
        { propagateErrors: true }
      )
      .pipe(
        take(1),
        catchError((error) => {
          this.mediaError.report(error, {
            operation: 'refreshProfileMediaPreview',
            reasonHint: 'media_access_temporarily_unavailable',
            metadata: {
              scope: 'ProfileMediaShowcaseViewerFacade',
              hasOwnerUid: true,
            },
          });
          return EMPTY;
        }),
        switchMap((preview) => {
          const items = [...preview.items];
          const refreshedIndex = items.findIndex(
            (candidate) => this.identity(candidate) === requestedIdentity
          );
          const safeFallbackIndex = Math.max(
            0,
            Math.min(fallbackIndex, Math.max(0, items.length - 1))
          );
          const fallbackItem = items[safeFallbackIndex] ?? null;
          const selected = refreshedIndex >= 0
            ? items[refreshedIndex]
            : fallbackItem &&
                this.identity(fallbackItem) === requestedIdentity
              ? fallbackItem
              : null;

          if (!selected) {
            this.errorNotification.showWarning(
              'Esta mídia não está mais disponível para visitantes.'
            );
            return EMPTY;
          }

          return this.mixedViewerLauncher
            .open$({
              items,
              selected,
              source: 'profile',
            })
            .pipe(
              catchError((error) => {
                this.mediaError.report(error, {
                  operation: 'openMedia.viewer',
                  reasonHint: 'media_navigation_failed',
                  metadata: {
                    scope: 'ProfileMediaShowcaseViewerFacade',
                    mediaType:
                      selected.mediaType === 'VIDEO' ? 'VIDEO' : 'PHOTO',
                    hasOwnerUid: true,
                    hasMediaId: !!selected.id,
                  },
                });
                return EMPTY;
              })
            );
        }),
        finalize(() => {
          this.opening.set(false);
        })
      );
  }
}
