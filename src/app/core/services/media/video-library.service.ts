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

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Firestore,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, combineLatest, defer, from, of, timer } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import {
  IVideoItem,
  VideoProcessingStatus,
} from 'src/app/core/interfaces/media/i-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import {
  buildPrivateVideoPreviewCacheKey,
  PrivateVideoPreviewCache,
  type PrivateVideoPreviewCacheEntry,
} from './private-video-preview-cache';
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly authSession = inject(AuthSessionService);
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly globalErrorHandler = inject(MediaApplicationErrorService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly accessWarningOwners = new Set<string>();
  private readonly previewCache = new PrivateVideoPreviewCache();
  private readonly previewInFlight = new Map<
    string,
    Observable<PrivateVideoAccessResponse>
  >();
  private lastSessionUid: string | null | undefined = undefined;
  private sessionEpoch = 0;
  private readonly privateVideoAccessCallable = httpsCallable<
    PrivateVideoAccessRequest,
    PrivateVideoAccessResponse
  >(this.functions, 'getPrivateVideoAccessUrls');

  constructor() {
    this.authSession.uid$
      .pipe(
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((uid) => {
        const normalizedUid = uid?.trim() || null;

        if (this.lastSessionUid !== normalizedUid) {
          this.sessionEpoch += 1;
          this.previewCache.clear();
          this.previewInFlight.clear();
          this.accessWarningOwners.clear();
        }

        this.lastSessionUid = normalizedUid;
      });
  }

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
   * Compatibilidade para consumidores existentes: metadados reativos e capas.
   * Nunca autoriza playback automaticamente. A renovação periódica, somente
   * enquanto houver assinantes, é exclusiva das capas para evitar expiração.
   * Reproduzir um vídeo exige chamar hydrateOwnedVideoAccess$ sob demanda.
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
        this.hydrateOwnedVideoPreviewAccess$(safeOwnerUid, items)
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

    // O trabalho só começa com subscriber ativo. Chamadas já assinadas são
    // reutilizadas em memória; mudanças de sessão/UID invalidam toda a tabela.
    return defer(() => {
      const sessionScope = this.currentSessionScope();
      const fallback = items.map((item) => this.withoutTemporaryAccess(item));

      if (
        this.lastSessionUid !== undefined &&
        this.lastSessionUid !== safeOwnerUid
      ) {
        return of(fallback);
      }

      const nowMs = Date.now();
      const resolved = new Map<string, PrivateVideoPreviewCacheEntry>();
      const pending: IVideoItem[] = [];
      const cacheKeys = new Map<string, string>();

      for (const item of items) {
        const key = buildPrivateVideoPreviewCacheKey({
          sessionScope,
          ownerUid: safeOwnerUid,
          videoId: item.id,
          revision: item.updatedAt ?? item.processingCompletedAt ?? item.createdAt,
          status: item.status,
        });
        cacheKeys.set(item.id, key);
        const cached = this.previewCache.get(key, nowMs);

        if (cached) {
          resolved.set(item.id, cached);
        } else {
          pending.push(item);
        }
      }

      const materialize = (): IVideoItem[] =>
        items.map((item) => {
          const access = resolved.get(item.id);

          return {
            ...this.withoutTemporaryAccess(item),
            thumbnailUrl: access?.posterUrl ?? null,
            thumbnailPath: access?.posterPath ?? item.thumbnailPath,
          };
        });

      if (pending.length === 0) {
        return of(materialize());
      }

      return this.requestPrivateVideoPreviews$(
        safeOwnerUid,
        pending.map((item) => item.id),
        sessionScope
      ).pipe(
        map((response) => {
          if (sessionScope !== this.currentSessionScope()) {
            return fallback;
          }

          const responseNow = Date.now();
          const requestedIds = new Set(pending.map((item) => item.id));

          for (const access of response.items) {
            if (!requestedIds.has(access.videoId)) {
              continue;
            }

            const entry: PrivateVideoPreviewCacheEntry = {
              posterUrl: access.posterUrl,
              posterPath: access.posterPath,
              expiresAt: access.expiresAt,
            };
            const key = cacheKeys.get(access.videoId);

            if (!key) continue;
            this.previewCache.set(key, entry, responseNow);

            const reusable = this.previewCache.get(key, responseNow);
            if (reusable) {
              resolved.set(access.videoId, reusable);
            }
          }

          return materialize();
        }),
        catchError((error) => {
          if (sessionScope !== this.currentSessionScope()) {
            return of(fallback);
          }

          this.reportSilent(error, {
            op: 'hydrateOwnedVideoPreviewAccess$',
            hasOwnerUid: !!safeOwnerUid,
            itemCount: pending.length,
          });
          return of(materialize());
        })
      );
    });
  }

  private requestPrivateVideoPreviews$(
    ownerUid: string,
    videoIds: readonly string[],
    sessionScope: string
  ): Observable<PrivateVideoAccessResponse> {
    const sortedIds = [...new Set(videoIds)].sort();
    const key = JSON.stringify([sessionScope, ownerUid, sortedIds]);
    const existing = this.previewInFlight.get(key);

    if (existing) {
      return existing;
    }

    // Promise do Firebase não cancela I/O após iniciar. Compartilhar evita
    // duplicar reads/assinaturas quando snapshots consecutivos chegam juntos.
    const request$: Observable<PrivateVideoAccessResponse> = defer(() =>
      from(this.privateVideoAccessCallable({
        ownerUid,
        videoIds: sortedIds,
        mode: 'PREVIEW',
      }))
    ).pipe(
      map((result) => result.data),
      finalize(() => {
        if (this.previewInFlight.get(key) === request$) {
          this.previewInFlight.delete(key);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.previewInFlight.set(key, request$);
    return request$;
  }

  private hydratePrivateUrls$(
    ownerUid: string,
    items: IVideoItem[]
  ): Observable<IVideoItem[]> {
    if (!items.length) {
      this.accessWarningOwners.delete(ownerUid);
      return of([]);
    }

    return defer(() => {
      const sessionScope = this.currentSessionScope();
      const fallback = items.map((item) => this.withoutTemporaryAccess(item));
      if (
        this.lastSessionUid !== undefined &&
        this.lastSessionUid !== ownerUid
      ) {
        return of(fallback);
      }

      return from(
        this.privateVideoAccessCallable({
          ownerUid,
          videoIds: items.map((item) => item.id),
          mode: 'PLAYBACK',
        })
      ).pipe(
      map((response) => {
        if (sessionScope !== this.currentSessionScope()) {
          return items.map((item) => this.withoutTemporaryAccess(item));
        }

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
        if (sessionScope !== this.currentSessionScope()) {
          return of(fallback);
        }

        this.handleHydrationError(error, ownerUid, items.length);
        return of(fallback);
      })
      );
    });
  }

  private currentSessionScope(): string {
    const uidScope = this.lastSessionUid
      ? `session:uid:${this.lastSessionUid}`
      : this.lastSessionUid === undefined
        ? 'session:pending'
        : 'session:anonymous';

    return `${uidScope}:epoch:${this.sessionEpoch}`;
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
    this.globalErrorHandler.reportReason(
      'media_access_temporarily_unavailable',
      {
        operation: 'videoLibrary.temporaryAccess',
        metadata: {
          hasOwnerUid: !!ownerUid,
          unavailableCount,
        },
      }
    );
  }

  private handleReadError(error: unknown, ownerUid: string): void {
    this.privacyDebug.log('media', 'VideoLibrary: erro ao carregar vídeos', {
      hasOwnerUid: !!ownerUid,
    });

    this.globalErrorHandler.report(error, {
      operation: 'watchOwnedVideoMetadata$',
      reasonHint: 'video_library_load_failed',
      metadata: {
        scope: 'VideoLibraryService',
        hasOwnerUid: !!ownerUid,
      },
    });
  }

  private reportSilent(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    this.globalErrorHandler.reportSilently(
      error,
      String(context['op'] ?? 'unknown'),
      undefined,
      {
        scope: 'VideoLibraryService',
        ...context,
      },
      'video_library_load_failed'
    );
  }
}
