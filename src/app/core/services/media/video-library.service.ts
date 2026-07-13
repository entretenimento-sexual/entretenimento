// src/app/core/services/media/video-library.service.ts
// -----------------------------------------------------------------------------
// Leitura da biblioteca privada de vídeos.
//
// Segurança:
// - lê somente users/{uid}/videos para o próprio dono;
// - documentos persistem paths, não URLs de download com token;
// - URLs temporárias são emitidas pelo backend após revalidar o proprietário;
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
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, combineLatest, from, of, timer } from 'rxjs';
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

interface PrivateVideoAccessRequest {
  ownerUid: string;
  videoIds: string[];
}

interface PrivateVideoAccessResponseItem {
  videoId: string;
  url: string;
  posterUrl: string | null;
  playbackPath: string;
  posterPath: string | null;
  expiresAt: number;
}

interface PrivateVideoAccessResponse {
  items: PrivateVideoAccessResponseItem[];
}

const PRIVATE_ACCESS_REFRESH_MS = 8 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class VideoLibraryService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly privateVideoAccessCallable = httpsCallable<
    PrivateVideoAccessRequest,
    PrivateVideoAccessResponse
  >(this.functions, 'getPrivateVideoAccessUrls');

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
      const metadata$ = collectionData(videosQuery, { idField: 'id' }).pipe(
        map((items) =>
          (items as IVideoDoc[])
            .map((item) => this.mapVideoDoc(safeOwnerUid, item))
            .filter((item) => this.hasValidIdentityAndPath(item))
        )
      );

      return combineLatest([
        metadata$,
        timer(0, PRIVATE_ACCESS_REFRESH_MS),
      ]).pipe(
        switchMap(([items]) =>
          this.hydratePrivateUrls$(safeOwnerUid, items)
        )
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

    return from(
      this.privateVideoAccessCallable({
        ownerUid,
        videoIds: items.map((item) => item.id),
      })
    ).pipe(
      map((response) => {
        const accessByVideoId = new Map(
          response.data.items.map((access) => [access.videoId, access])
        );

        return items.flatMap((item) => {
          const access = accessByVideoId.get(item.id);

          if (!access?.url) {
            return [];
          }

          return [{
            ...item,
            url: access.url,
            playbackPath: access.playbackPath,
            processedStoragePath:
              item.status === 'ready'
                ? item.processedStoragePath ?? access.playbackPath
                : item.processedStoragePath,
            thumbnailUrl: access.posterUrl,
            thumbnailPath: access.posterPath ?? item.thumbnailPath,
          }];
        });
      })
    );
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
