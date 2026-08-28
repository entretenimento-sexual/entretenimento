import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import type { IPublicMediaContinuationContext } from 'src/app/core/interfaces/media/i-public-media-continuation-context';
import type {
  IPublicMediaViewerHandoffResult,
  IPublicMediaViewerMixedNavigation,
} from 'src/app/core/interfaces/media/i-public-media-viewer-session';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import type { TPhotoViewSource } from 'src/app/core/services/media/photo-view-tracking.service';
import type { IProfilePhotoItem } from './photo-viewer.component';

export interface OpenPublicPhotoViewerRequest {
  readonly items: readonly IPublicPhotoItem[];
  readonly selected: IPublicPhotoItem;
  readonly source: TPhotoViewSource;
  readonly continuationContext?: IPublicMediaContinuationContext;
  readonly mixedNavigation?: IPublicMediaViewerMixedNavigation;
}

/**
 * Porta canônica para abrir fotos públicas no viewer interativo.
 *
 * O viewer resolve comentários, reações, moderação e tracking pela identidade
 * `ownerUid + photoId` da foto ativa. Por isso uma origem mista pode preservar
 * autores diferentes na mesma fila sem encaminhar interação ao perfil errado.
 */
@Injectable({ providedIn: 'root' })
export class PublicPhotoViewerLauncherService {
  private readonly dialog = inject(MatDialog);
  private readonly globalError = inject(GlobalErrorHandlerService);

  open$(request: OpenPublicPhotoViewerRequest): Observable<void> {
    return this.openDialog$(request).pipe(map(() => void 0));
  }

  openWithResult$(
    request: OpenPublicPhotoViewerRequest
  ): Observable<IPublicMediaViewerHandoffResult | undefined> {
    return this.openDialog$(request).pipe(
      switchMap((dialogRef) => dialogRef.afterClosed().pipe(take(1)))
    );
  }

  private openDialog$(
    request: OpenPublicPhotoViewerRequest
  ): Observable<MatDialogRef<any, IPublicMediaViewerHandoffResult>> {
    const selectedKey = this.photoKey(request.selected);
    const selectedOwnerUid = String(request.selected?.ownerUid ?? '').trim();

    if (!selectedKey || !selectedOwnerUid) {
      return throwError(() => new Error(
        'Foto pública indisponível para abertura.'
      ));
    }

    const openableItems = [...(request.items ?? [])]
      .filter((item) => this.isOpenablePhoto(item));
    const startIndex = openableItems.findIndex((item) =>
      this.photoKey(item) === selectedKey
    );

    if (startIndex < 0) {
      return throwError(() => new Error(
        'Foto pública não está mais disponível nesta fila.'
      ));
    }

    const viewerItems = openableItems.map((item) => this.toViewerPhotoItem(item));
    const viewerComponent$ = request.mixedNavigation
      ? defer(() => from(import('./public-mixed-photo-viewer.component'))).pipe(
          map(({ PublicMixedPhotoViewerComponent }) => PublicMixedPhotoViewerComponent)
        )
      : defer(() => from(import('./photo-viewer.component'))).pipe(
          map(({ PhotoViewerComponent }) => PhotoViewerComponent)
        );

    return viewerComponent$.pipe(
      map((ViewerComponent) => this.dialog.open<any, any, IPublicMediaViewerHandoffResult>(
        ViewerComponent,
        {
          data: {
            ownerUid: selectedOwnerUid,
            items: viewerItems,
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
            'photo-viewer-dialog',
            'photo-viewer-dialog--immersive',
          ],
          backdropClass: 'photo-viewer-backdrop',
        }
      )),
      catchError((error: unknown) => {
        this.reportError(
          error,
          request.selected,
          request.source,
          openableItems.length
        );
        return throwError(() => error);
      })
    );
  }

  private isOpenablePhoto(item: IPublicPhotoItem | null | undefined): boolean {
    return (
      !!this.photoKey(item) &&
      !!String(item?.url ?? '').trim() &&
      item?.visibility === 'PUBLIC' &&
      item?.moderationStatus === 'APPROVED'
    );
  }

  private photoKey(item: IPublicPhotoItem | null | undefined): string {
    const ownerUid = String(item?.ownerUid ?? '').trim();
    const photoId = String(item?.id ?? '').trim();
    return ownerUid && photoId ? `${ownerUid}:${photoId}` : '';
  }

  private toViewerPhotoItem(item: IPublicPhotoItem): IProfilePhotoItem {
    return {
      id: item.id,
      ownerUid: item.ownerUid,
      url: item.url,
      alt: item.alt,
      createdAt: item.createdAt,
      ownerNickname: item.ownerNickname ?? null,
      ownerPhotoURL: item.ownerPhotoURL ?? null,
      commentsEnabled: item.commentsEnabled ?? false,
      commentsPolicy: item.commentsPolicy ?? 'OFF',
      reactionsEnabled: item.reactionsEnabled ?? false,
      moderationStatus: item.moderationStatus ?? 'PRIVATE',
    };
  }

  private reportError(
    error: unknown,
    selected: IPublicPhotoItem,
    source: TPhotoViewSource,
    itemCount: number
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao abrir o visualizador público de foto.');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: Record<string, unknown>;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'PublicPhotoViewerLauncherService',
        op: 'open$',
        source,
        hasOwnerUid: !!selected.ownerUid,
        hasPhotoId: !!selected.id,
        itemCount,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // A falha de diagnóstico não deve substituir o erro original.
    }
  }
}
