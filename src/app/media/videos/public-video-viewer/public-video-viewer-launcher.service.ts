import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import type { IPublicMediaContinuationContext } from 'src/app/core/interfaces/media/i-public-media-continuation-context';
import type {
  IPublicMediaViewerHandoffResult,
  IPublicMediaViewerMixedNavigation,
} from 'src/app/core/interfaces/media/i-public-media-viewer-session';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import type { TVideoViewSource } from 'src/app/core/services/media/video-view-tracking.service';

export interface OpenPublicVideoViewerRequest {
  readonly items: readonly IPublicVideoItem[];
  readonly startIndex: number;
  readonly source: TVideoViewSource;
  readonly continuationContext?: IPublicMediaContinuationContext;
  readonly mixedNavigation?: IPublicMediaViewerMixedNavigation;
}

@Injectable({ providedIn: 'root' })
export class PublicVideoViewerLauncherService {
  private readonly dialog = inject(MatDialog);
  private readonly globalError = inject(GlobalErrorHandlerService);

  open$(request: OpenPublicVideoViewerRequest): Observable<void> {
    return this.openDialog$(request).pipe(map(() => void 0));
  }

  openWithResult$(
    request: OpenPublicVideoViewerRequest
  ): Observable<IPublicMediaViewerHandoffResult | undefined> {
    return this.openDialog$(request).pipe(
      switchMap((dialogRef) => dialogRef.afterClosed().pipe(take(1)))
    );
  }

  private openDialog$(
    request: OpenPublicVideoViewerRequest
  ): Observable<MatDialogRef<any, IPublicMediaViewerHandoffResult>> {
    const items = [...(request.items ?? [])].filter((item) =>
      !!item?.id?.trim() &&
      !!item?.ownerUid?.trim() &&
      item.mediaType === 'VIDEO' &&
      item.visibility === 'PUBLIC' &&
      item.moderationStatus === 'APPROVED'
    );
    const startIndex = this.normalizeStartIndex(request.startIndex, items.length);
    const selected = items[startIndex] ?? null;

    if (!selected) {
      return throwError(() => new Error('Vídeo público indisponível para abertura.'));
    }

    const viewerComponent$ = request.mixedNavigation
      ? defer(() => from(import('./public-mixed-video-viewer.component'))).pipe(
          map(({ PublicMixedVideoViewerComponent }) => PublicMixedVideoViewerComponent)
        )
      : defer(() => from(import('./public-video-viewer.component'))).pipe(
          map(({ PublicVideoViewerComponent }) => PublicVideoViewerComponent)
        );

    return viewerComponent$.pipe(
      map((ViewerComponent) => this.dialog.open<any, any, IPublicMediaViewerHandoffResult>(
        ViewerComponent,
        {
          data: {
            ownerUid: selected.ownerUid,
            items,
            startIndex,
            source: request.source,
            continuationContext: request.continuationContext,
            mixedNavigation: request.mixedNavigation,
          },
          autoFocus: false,
          restoreFocus: true,
          width: '100vw',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
          panelClass: [
            'photo-viewer-dialog--immersive',
            'public-video-viewer-dialog',
          ],
          backdropClass: 'photo-viewer-backdrop',
        }
      )),
      catchError((error: unknown) => {
        this.reportError(error, selected, request.source, items.length);
        return throwError(() => error);
      })
    );
  }

  private normalizeStartIndex(value: unknown, length: number): number {
    const parsed = Number(value ?? 0);

    if (!Number.isFinite(parsed) || length <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(Math.trunc(parsed), length - 1));
  }

  private reportError(
    error: unknown,
    selected: IPublicVideoItem,
    source: TVideoViewSource,
    itemCount: number
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao abrir o visualizador público de vídeo.');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: Record<string, unknown>;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'PublicVideoViewerLauncherService',
        op: 'open$',
        source,
        hasOwnerUid: !!selected.ownerUid,
        hasVideoId: !!selected.id,
        itemCount,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // A falha de diagnóstico não deve substituir o erro original.
    }
  }
}
