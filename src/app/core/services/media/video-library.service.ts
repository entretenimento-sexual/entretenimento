// src/app/core/services/media/video-library.service.ts
// -----------------------------------------------------------------------------
// Leitura da biblioteca privada de vídeos.
//
// Segurança:
// - lê somente users/{uid}/videos para o próprio dono;
// - documentos persistem paths, não URLs de download com token;
// - URLs privadas são resolvidas em memória sob as regras do Storage;
// - quando pronto, o player usa o derivado processado e preserva o bruto privado;
// - publicação pública pertence a serviço e Functions específicos.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { getDownloadURL, ref } from 'firebase/storage';
import { Observable, forkJoin, from, of } from 'rxjs';
import {
  catchError,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import {
  IVideoItem,
  VideoProcessingStatus,
} from 'src/app/core/interfaces/media/i-video-item';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

interface IVideoDoc {
  id?: string;
  url?: string;
  path?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sourceMimeType?: string | null;
  sourceSizeBytes?: number | null;
  durationMs?: number | null;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  playbackPath?: string | null;
  processedStoragePath?: string | null;
  processedOutputPrefix?: string | null;
  processedMimeType?: string | null;
  processedSizeBytes?: number | null;
  processingJobId?: string | null;
  processingStage?: string | null;
  processingErrorCode?: string | null;
  processingErrorMessage?: string | null;
  processingCompletedAt?: unknown;
  status?: VideoProcessingStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class VideoLibraryService {
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  watchPrivateVideos$(ownerUid: string): Observable<IVideoItem[]> {
    const safeOwnerUid = this.normalizeUid(ownerUid);

    if (!safeOwnerUid) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const videosRef = collection(
        this.firestore,
        `users/${safeOwnerUid}/videos`
      );
      const videosQuery = query(
        videosRef,
        orderBy('createdAt', 'desc'),
        limit(60)
      );

      return collectionData(videosQuery, { idField: 'id' }).pipe(
        map((items) =>
          (items as IVideoDoc[])
            .map((item) => this.mapVideoDoc(safeOwnerUid, item))
            .filter((item) => this.hasValidIdentityAndPath(item))
        ),
        switchMap((items) => this.hydratePrivateUrls$(safeOwnerUid, items))
      );
    }).pipe(
      catchError((error) => {
        this.handleReadError(error, safeOwnerUid);
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private hydratePrivateUrls$(
    ownerUid: string,
    items: IVideoItem[]
  ): Observable<IVideoItem[]> {
    if (!items.length) {
      return of([]);
    }

    return forkJoin(
      items.map((item) => this.hydratePrivateItem$(ownerUid, item))
    ).pipe(
      map((resolvedItems) =>
        resolvedItems.filter(
          (item): item is IVideoItem => item !== null
        )
      )
    );
  }

  private hydratePrivateItem$(
    ownerUid: string,
    item: IVideoItem
  ): Observable<IVideoItem | null> {
    const rawVideoPath = this.extractOwnedVideoPath(
      ownerUid,
      item.path ?? item.url
    );

    if (!rawVideoPath) {
      return of(null);
    }

    const processedVideoPath = this.extractOwnedProcessedPath(
      ownerUid,
      item.id,
      item.processedStoragePath ?? item.playbackPath
    );
    const playbackPath = item.status === 'ready' && processedVideoPath
      ? processedVideoPath
      : rawVideoPath;
    const posterPath = this.extractOwnedPosterPath(
      ownerUid,
      item.id,
      item.thumbnailPath ?? item.thumbnailUrl
    );
    const videoUrl$ = this.resolvePrivateLocation$(
      playbackPath === rawVideoPath ? item.url : null,
      playbackPath
    );
    const posterUrl$ = posterPath
      ? this.resolvePrivateLocation$(item.thumbnailUrl, posterPath).pipe(
          catchError((error) => {
            this.reportItemReadError(error, item.id, 'poster');
            return of(null);
          })
        )
      : of(null);

    return forkJoin({
      videoUrl: videoUrl$,
      posterUrl: posterUrl$,
    }).pipe(
      map(({ videoUrl, posterUrl }) => ({
        ...item,
        url: videoUrl,
        path: rawVideoPath,
        playbackPath,
        processedStoragePath: processedVideoPath,
        thumbnailUrl: posterUrl,
        thumbnailPath: posterPath,
      })),
      catchError((error) => {
        this.reportItemReadError(error, item.id, 'video');
        return of(null);
      })
    );
  }

  private resolvePrivateLocation$(
    storedValue: string | null | undefined,
    storagePath: string
  ): Observable<string> {
    const normalizedValue = String(storedValue ?? '').trim();

    if (this.isHttpUrl(normalizedValue)) {
      return of(normalizedValue);
    }

    return from(getDownloadURL(ref(this.storage, storagePath)));
  }

  private mapVideoDoc(ownerUid: string, item: IVideoDoc): IVideoItem {
    return {
      id: String(item.id ?? '').trim(),
      ownerUid,
      url: String(item.url ?? item.path ?? '').trim(),
      path: this.normalizeOptionalText(item.path),
      fileName: this.normalizeOptionalText(item.fileName),
      mimeType: this.normalizeOptionalText(item.mimeType),
      sizeBytes: this.normalizeOptionalPositiveNumber(item.sizeBytes),
      sourceMimeType: this.normalizeOptionalText(item.sourceMimeType),
      sourceSizeBytes: this.normalizeOptionalPositiveNumber(item.sourceSizeBytes),
      durationMs: this.normalizeOptionalPositiveNumber(item.durationMs),
      thumbnailUrl: this.normalizeOptionalText(item.thumbnailUrl),
      thumbnailPath: this.normalizeOptionalText(item.thumbnailPath),
      playbackPath: this.normalizeOptionalText(item.playbackPath),
      processedStoragePath: this.normalizeOptionalText(
        item.processedStoragePath
      ),
      processedOutputPrefix: this.normalizeOptionalText(
        item.processedOutputPrefix
      ),
      processedMimeType: this.normalizeOptionalText(item.processedMimeType),
      processedSizeBytes: this.normalizeOptionalPositiveNumber(
        item.processedSizeBytes
      ),
      processingJobId: this.normalizeOptionalText(item.processingJobId),
      processingStage: this.normalizeOptionalText(item.processingStage),
      processingErrorCode: this.normalizeOptionalText(
        item.processingErrorCode
      ),
      processingErrorMessage: this.normalizeOptionalText(
        item.processingErrorMessage
      ),
      processingCompletedAt: this.normalizeOptionalDateMs(
        item.processingCompletedAt
      ),
      status: this.normalizeStatus(item.status),
      createdAt: this.normalizeDateMs(item.createdAt),
      updatedAt: this.normalizeOptionalDateMs(item.updatedAt),
    };
  }

  private hasValidIdentityAndPath(item: IVideoItem): boolean {
    return !!item.id && !!item.path;
  }

  private extractOwnedVideoPath(ownerUid: string, value: unknown): string | null {
    const storagePath = this.resolveStoragePath(value);
    const escapedUid = this.escapeRegExp(ownerUid);

    if (!storagePath) {
      return null;
    }

    return new RegExp(
      `^users/${escapedUid}/uploads/videos/[^/]+$`
    ).test(storagePath)
      ? storagePath
      : null;
  }

  private extractOwnedProcessedPath(
    ownerUid: string,
    videoId: string,
    value: unknown
  ): string | null {
    const storagePath = this.resolveStoragePath(value);
    const escapedUid = this.escapeRegExp(ownerUid);
    const escapedVideoId = this.escapeRegExp(videoId);

    if (!storagePath || !escapedVideoId) {
      return null;
    }

    return new RegExp(
      `^users/${escapedUid}/processed/videos/${escapedVideoId}/[^/]+/.+$`
    ).test(storagePath)
      ? storagePath
      : null;
  }

  private extractOwnedPosterPath(
    ownerUid: string,
    videoId: string,
    value: unknown
  ): string | null {
    const storagePath = this.resolveStoragePath(value);
    const escapedUid = this.escapeRegExp(ownerUid);
    const escapedVideoId = this.escapeRegExp(videoId);

    if (!storagePath || !escapedVideoId) {
      return null;
    }

    return new RegExp(
      `^users/${escapedUid}/uploads/video-posters/${escapedVideoId}/[^/]+$`
    ).test(storagePath)
      ? storagePath
      : null;
  }

  private resolveStoragePath(value: unknown): string | null {
    const normalized = String(value ?? '').trim();

    if (!normalized) {
      return null;
    }

    if (!this.isHttpUrl(normalized)) {
      return normalized.replace(/^\/+/, '');
    }

    try {
      const parsedUrl = new URL(normalized);
      const marker = '/o/';
      const markerIndex = parsedUrl.pathname.indexOf(marker);

      if (markerIndex < 0) {
        return null;
      }

      return decodeURIComponent(
        parsedUrl.pathname.slice(markerIndex + marker.length)
      ).replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeUid(value: unknown): string {
    const uid = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
  }

  private normalizeStatus(value: unknown): VideoProcessingStatus {
    return value === 'queued' ||
      value === 'processing' ||
      value === 'ready' ||
      value === 'failed'
      ? value
      : 'uploaded';
  }

  private normalizeOptionalPositiveNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0
      ? Math.trunc(numberValue)
      : null;
  }

  private normalizeOptionalText(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private normalizeDateMs(value: unknown): number {
    return this.normalizeOptionalDateMs(value) ?? Date.now();
  }

  private normalizeOptionalDateMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof (value as { toDate?: unknown }).toDate === 'function'
    ) {
      try {
        return (value as { toDate: () => Date }).toDate().getTime();
      } catch {
        return null;
      }
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'seconds' in value &&
      typeof (value as { seconds?: unknown }).seconds === 'number'
    ) {
      return Number((value as { seconds: number }).seconds) * 1000;
    }

    return null;
  }

  private reportItemReadError(
    error: unknown,
    videoId: string,
    assetKind: 'video' | 'poster'
  ): void {
    this.reportSilent(error, {
      op: 'hydratePrivateItem$',
      assetKind,
      hasVideoId: !!videoId,
    });
  }

  private handleReadError(error: unknown, ownerUid: string): void {
    this.privacyDebug.log('media', 'VideoLibrary: erro ao carregar vídeos', {
      hasOwnerUid: !!ownerUid,
    });

    this.reportSilent(error, {
      op: 'watchPrivateVideos$',
      hasOwnerUid: !!ownerUid,
    });
    this.errorNotifier.showError('Erro ao carregar vídeos.');
  }

  private reportSilent(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Erro ao carregar vídeo privado.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'VideoLibraryService',
        ...context,
      };
      (normalized as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
