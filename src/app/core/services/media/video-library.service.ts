// src/app/core/services/media/video-library.service.ts
// -----------------------------------------------------------------------------
// Leitura dos vídeos pertencentes ao usuário.
//
// Segurança:
// - lê somente users/{uid}/videos para o próprio dono;
// - documentos persistem paths, nunca URLs de download com token;
// - URLs temporárias são emitidas pelo backend após revalidar o proprietário;
// - metadados podem ser cacheados no NgRx, mas URLs e paths não;
// - cards da biblioteca pedem somente poster; playback completo é sob demanda;
// - quando pronto, o player usa o derivado processado e preserva o bruto apenas
//   durante o ciclo técnico necessário à publicação.
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

type PrivateVideoAccessMode = 'PREVIEW' | 'PLAYBACK';

interface PrivateVideoAccessRequest {
  ownerUid: string;
  videoIds: string[];
  mode?: PrivateVideoAccessMode;
}

interface PrivateVideoAccessResponseItem {
  videoId: string;
  url: string | null;
  posterUrl: string | null;
  playbackPath: string | null;
  posterPath: string | null;
  expiresAt: number;
}

interface PrivateVideoAccessResponse {
  items: PrivateVideoAccessResponseItem[];
}

export const VIDEO_OWNER_ACCESS_REFRESH_MS = 8 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class VideoLibraryService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly accessWarningOwners = new Set<string>();
  private readonly privateVideoAccessCallable = httpsCallable<
    PrivateVideoAccessRequest,
    PrivateVideoAccessResponse
  >(this.functions, 'getPrivateVideoAccessUrls');

  /**
   * Fonte reativa de metadados. Não emite URL assinada.
   * É o fluxo apropriado para efeitos/cache serializável do NgRx.
   */
  watchOwnedVideoMetadata$(ownerUid: string): Observable<IVideoItem[]> {
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

      return collectionData(videosQuery, { idField: 'id' });
    }).pipe(
      map((items) =>
        (items as IVideoDoc[])
          .map((item) => this.mapVideoDoc(safeOwnerUid, item))
          .filter((item) => this.hasValidIdentityAndPath(item))
      ),
      catchError((error) => {
        this.handleReadError(error, safeOwnerUid);
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Compatibilidade para consumidores existentes: metadados reativos mais
   * hidratação temporária de playback em memória. Nada deste retorno deve ser
   * persistido.
   */
  watchPrivateVideos$(ownerUid: string): Observable<IVideoItem[]> {
    const safeOwnerUid = this.normalizeUid(ownerUid);

    if (!safeOwnerUid) {
      return of([]);
    }

    return combineLatest([
      this.watchOwnedVideoMetadata$(safeOwnerUid),
      timer(0, VIDEO_OWNER_ACCESS_REFRESH_MS),
    ]).pipe(
      switchMap(([items]) =>
        this.hydrateOwnedVideoAccess$(safeOwnerUid, items)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Hidrata playback completo somente em memória para consumidores que
   * realmente precisam reproduzir o vídeo.
   */
  hydrateOwnedVideoAccess$(
    ownerUid: string,
    items: readonly IVideoItem[]
  ): Observable<IVideoItem[]> {
    const safeOwnerUid = this.normalizeUid(ownerUid);

    if (!safeOwnerUid) {
      return of(items.map((item) => this.withoutTemporaryAccess(item)));
    }

    return this.hydratePrivateUrls$(safeOwnerUid, [...items]);
  }

  /**
   * Hidrata somente posters para cards/listas da biblioteca. O backend não
   * verifica nem assina o arquivo de playback neste modo.
   */
  hydrateOwnedVideoPreviewAccess$(
    ownerUid: string,
    items: readonly IVideoItem[]
  ): Observable<IVideoItem[]> {
    const safeOwnerUid = this.normalizeUid(ownerUid);

    if (!safeOwnerUid || items.length === 0) {
      return of(items.map((item) => this.withoutTemporaryAccess(item)));
    }

    return from(
      this.privateVideoAccessCallable({
        ownerUid: safeOwnerUid,
        videoIds: items.map((item) => item.id),
        mode: 'PREVIEW',
      })
    ).pipe(
      map((response) => {
        const accessByVideoId = new Map(
          response.data.items.map((access) => [access.videoId, access])
        );

        return items.map((item) => {
          const access = accessByVideoId.get(item.id);

          return {
            ...this.withoutTemporaryAccess(item),
            thumbnailUrl: access?.posterUrl ?? null,
            thumbnailPath: access?.posterPath ?? item.thumbnailPath,
          };
        });
      }),
      catchError((error) => {
        this.reportSilent(error, {
          op: 'hydrateOwnedVideoPreviewAccess$',
          hasOwnerUid: !!safeOwnerUid,
          itemCount: items.length,
        });
        return of(items.map((item) => this.withoutTemporaryAccess(item)));
      })
    );
  }

  private hydratePrivateUrls$(
    ownerUid: string,
    items: IVideoItem[]
  ): Observable<IVideoItem[]> {
    if (!items.length) {
      this.accessWarningOwners.delete(ownerUid);
      return of([]);
    }

    return from(
      this.privateVideoAccessCallable({
        ownerUid,
        videoIds: items.map((item) => item.id),
        mode: 'PLAYBACK',
      })
    ).pipe(
      map((response) => {
        const accessByVideoId = new Map(
          response.data.items.map((access) => [access.videoId, access])
        );
        let unavailableCount = 0;

        const hydrated = items.map((item) => {
          const access = accessByVideoId.get(item.id);

          if (!access?.url || !access.playbackPath) {
            unavailableCount += 1;
            return this.withoutTemporaryAccess(item);
          }

          return {
            ...item,
            url: access.url,
            playbackPath: access.playbackPath,
            processedStoragePath:
              item.status === 'ready'
                ? item.processedStoragePath ?? access.playbackPath
                : item.processedStoragePath,
            thumbnailUrl: access.posterUrl,
            thumbnailPath: access.posterPath ?? item.thumbnailPath,
          };
        });

        if (unavailableCount > 0) {
          this.notifyTemporaryAccessUnavailable(ownerUid, unavailableCount);
        } else {
          this.accessWarningOwners.delete(ownerUid);
        }

        return hydrated;
      }),
      catchError((error) => {
        this.handleHydrationError(error, ownerUid, items.length);
        return of(items.map((item) => this.withoutTemporaryAccess(item)));
      })
    );
  }

  private withoutTemporaryAccess(item: IVideoItem): IVideoItem {
    return {
      ...item,
      url: '',
      thumbnailUrl: null,
    };
  }

  private mapVideoDoc(ownerUid: string, item: IVideoDoc): IVideoItem {
    return {
      id: String(item.id ?? '').trim(),
      ownerUid,
      // URL reproduzível só pode vir da callable. Nunca reutilizar path interno.
      url: '',
      path: this.normalizeOptionalText(item.path ?? item.url),
      fileName: this.normalizeOptionalText(item.fileName),
      mimeType: this.normalizeOptionalText(item.mimeType),
      sizeBytes: this.normalizeOptionalPositiveNumber(item.sizeBytes),
      sourceMimeType: this.normalizeOptionalText(item.sourceMimeType),
      sourceSizeBytes: this.normalizeOptionalPositiveNumber(item.sourceSizeBytes),
      durationMs: this.normalizeOptionalPositiveNumber(item.durationMs),
      thumbnailUrl: null,
      thumbnailPath: this.normalizeOptionalText(
        item.thumbnailPath ?? item.thumbnailUrl
      ),
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

  private handleHydrationError(
    error: unknown,
    ownerUid: string,
    itemCount: number
  ): void {
    this.privacyDebug.log('media', 'VideoLibrary: acesso temporário indisponível', {
      hasOwnerUid: !!ownerUid,
      itemCount,
    });

    this.reportSilent(error, {
      op: 'hydrateOwnedVideoAccess$',
      hasOwnerUid: !!ownerUid,
      itemCount,
    });
    this.notifyTemporaryAccessUnavailable(ownerUid, itemCount);
  }

  private notifyTemporaryAccessUnavailable(
    ownerUid: string,
    unavailableCount: number
  ): void {
    if (this.accessWarningOwners.has(ownerUid)) {
      return;
    }

    this.accessWarningOwners.add(ownerUid);
    this.errorNotifier.showWarning(
      unavailableCount === 1
        ? 'O vídeo foi carregado, mas a reprodução está temporariamente indisponível.'
        : 'Seus vídeos foram carregados, mas algumas reproduções estão temporariamente indisponíveis.'
    );
  }

  private handleReadError(error: unknown, ownerUid: string): void {
    this.privacyDebug.log('media', 'VideoLibrary: erro ao carregar vídeos', {
      hasOwnerUid: !!ownerUid,
    });

    this.reportSilent(error, {
      op: 'watchOwnedVideoMetadata$',
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
        : new Error('Erro ao carregar vídeo.');

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
