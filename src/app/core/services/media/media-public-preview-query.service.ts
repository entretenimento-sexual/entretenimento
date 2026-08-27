// src/app/core/services/media/media-public-preview-query.service.ts
// -----------------------------------------------------------------------------
// Leitura limitada da prévia pública de mídias exibida no perfil.
//
// Objetivos:
// - nunca hidratar a galeria inteira para renderizar um showcase de poucos itens;
// - preservar contadores exatos usando métricas já materializadas no perfil;
// - manter a foto de capa elegível mesmo quando estiver fora da primeira janela;
// - hidratar signed URLs somente dos itens que efetivamente serão renderizados;
// - para vídeos, assinar somente poster nesta superfície de preview;
// - manter URLs temporárias somente nos caches em memória dos access services.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  limit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of, throwError } from 'rxjs';
import {
  catchError,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import {
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import { PublicVideoAccessService } from './public-video-access.service';

export interface MediaPublicPreviewQueryOptions {
  readonly propagateErrors?: boolean;
}

export interface IPublicProfileMediaPreview {
  readonly items: readonly IPublicProfileMediaItem[];
  readonly photosCount: number;
  readonly videosCount: number;
  readonly totalCount: number;
}

type PublicProfileMediaProjection =
  | IPublicPhotoProjection
  | IPublicVideoProjection;

interface PublicProfileMediaMetrics {
  readonly publicPhotosCount?: unknown;
  readonly photosCount?: unknown;
  readonly publicVideosCount?: unknown;
  readonly videosCount?: unknown;
  readonly coverPhotoId?: unknown;
}

interface PreviewCandidates {
  readonly metrics: PublicProfileMediaMetrics;
  readonly photos: readonly IPublicPhotoProjection[];
  readonly videos: readonly IPublicVideoProjection[];
}

interface SelectedPreview {
  readonly projections: readonly PublicProfileMediaProjection[];
  readonly photosCount: number;
  readonly videosCount: number;
  readonly totalCount: number;
}

const DEFAULT_PREVIEW_LIMIT = 5;
const MAX_PREVIEW_LIMIT = 8;

/**
 * Seleciona a janela visual final antes de qualquer autorização de signed URL.
 *
 * Cada coleção chega previamente limitada e ordenada pelo Firestore. A capa é
 * adicionada separadamente aos candidatos de foto, quando necessário, para que
 * a prioridade visual histórica seja preservada sem ler a coleção inteira.
 */
export function selectPublicProfileMediaPreviewCandidates(
  photos: readonly IPublicPhotoProjection[],
  videos: readonly IPublicVideoProjection[],
  takeCount = DEFAULT_PREVIEW_LIMIT
): PublicProfileMediaProjection[] {
  const safeLimit = normalizePreviewLimit(takeCount);
  const unique = new Map<string, PublicProfileMediaProjection>();

  for (const candidate of [...photos, ...videos]) {
    const key = buildProjectionIdentity(candidate);
    if (!key || unique.has(key)) continue;
    unique.set(key, candidate);
  }

  return [...unique.values()]
    .sort(compareProfileMediaProjection)
    .slice(0, safeLimit);
}

@Injectable({ providedIn: 'root' })
export class MediaPublicPreviewQueryService {
  private readonly firestore = inject(Firestore);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly publicPhotoAccess: PublicPhotoAccessService,
    private readonly publicVideoAccess: PublicVideoAccessService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  getProfilePublicMediaPreview$(
    ownerUid: string,
    takeCount = DEFAULT_PREVIEW_LIMIT,
    options: MediaPublicPreviewQueryOptions = {}
  ): Observable<IPublicProfileMediaPreview> {
    const safeOwnerUid = String(ownerUid ?? '').trim();
    const safeLimit = normalizePreviewLimit(takeCount);

    if (!safeOwnerUid) {
      return of(this.emptyPreview());
    }

    return combineLatest([
      this.getProfileMediaMetrics$(safeOwnerUid),
      this.getPhotoCandidates$(safeOwnerUid, safeLimit),
      this.getVideoCandidates$(safeOwnerUid, safeLimit),
    ]).pipe(
      switchMap(([metrics, photos, videos]) =>
        this.includeCoverCandidate$(safeOwnerUid, metrics, photos).pipe(
          map((safePhotos): PreviewCandidates => ({
            metrics,
            photos: safePhotos,
            videos,
          }))
        )
      ),
      map(({ metrics, photos, videos }): SelectedPreview => {
        const projections = selectPublicProfileMediaPreviewCandidates(
          photos,
          videos,
          safeLimit
        );
        const photosCount = Math.max(
          this.readMetricCount(
            metrics.publicPhotosCount ?? metrics.photosCount
          ),
          this.countUniquePhotos(photos)
        );
        const videosCount = Math.max(
          this.readMetricCount(
            metrics.publicVideosCount ?? metrics.videosCount
          ),
          this.countUniqueVideos(videos)
        );

        return {
          projections,
          photosCount,
          videosCount,
          totalCount: photosCount + videosCount,
        };
      }),
      switchMap((selected) => this.hydrateSelectedPreview$(selected)),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'getProfilePublicMediaPreview$',
          ownerUid: safeOwnerUid,
          takeCount: safeLimit,
        });

        return options.propagateErrors
          ? throwError(() => error)
          : of(this.emptyPreview());
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private getProfileMediaMetrics$(
    ownerUid: string
  ): Observable<PublicProfileMediaMetrics> {
    return this.firestoreCtx.deferObservable$(() => {
      const profileRef = doc(this.firestore, `public_profiles/${ownerUid}`);
      return docData(profileRef);
    }).pipe(
      map((value) =>
        (value && typeof value === 'object'
          ? value
          : {}) as PublicProfileMediaMetrics
      )
    );
  }

  private getPhotoCandidates$(
    ownerUid: string,
    takeCount: number
  ): Observable<IPublicPhotoProjection[]> {
    return this.firestoreCtx.deferObservable$(() => {
      const source = collection(
        this.firestore,
        `public_profiles/${ownerUid}/public_photos`
      );
      const sourceQuery = query(
        source,
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('orderIndex', 'asc'),
        orderBy('publishedAt', 'desc'),
        limit(takeCount)
      );

      return collectionData(sourceQuery, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoProjection[])
    );
  }

  private getVideoCandidates$(
    ownerUid: string,
    takeCount: number
  ): Observable<IPublicVideoProjection[]> {
    return this.firestoreCtx.deferObservable$(() => {
      const source = collection(
        this.firestore,
        `public_profiles/${ownerUid}/public_videos`
      );
      const sourceQuery = query(
        source,
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('orderIndex', 'asc'),
        orderBy('publishedAt', 'desc'),
        limit(takeCount)
      );

      return collectionData(sourceQuery, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicVideoProjection[])
    );
  }

  private includeCoverCandidate$(
    ownerUid: string,
    metrics: PublicProfileMediaMetrics,
    photos: readonly IPublicPhotoProjection[]
  ): Observable<readonly IPublicPhotoProjection[]> {
    const coverPhotoId = String(metrics.coverPhotoId ?? '').trim();

    if (
      !coverPhotoId ||
      photos.some((photo) => String(photo.id ?? '').trim() === coverPhotoId)
    ) {
      return of(photos);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const coverRef = doc(
        this.firestore,
        `public_profiles/${ownerUid}/public_photos/${coverPhotoId}`
      );
      return docData(coverRef, { idField: 'id' });
    }).pipe(
      map((candidate) => {
        const cover = candidate as IPublicPhotoProjection | undefined;

        if (
          !cover ||
          cover.visibility !== 'PUBLIC' ||
          cover.moderationStatus !== 'APPROVED'
        ) {
          return photos;
        }

        return [cover, ...photos];
      }),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'includeCoverCandidate$',
          ownerUid,
          coverPhotoId,
        });
        return of(photos);
      })
    );
  }

  private hydrateSelectedPreview$(
    selected: SelectedPreview
  ): Observable<IPublicProfileMediaPreview> {
    const photoProjections = selected.projections.filter(
      (item): item is IPublicPhotoProjection => !isVideoProjection(item)
    );
    const videoProjections = selected.projections.filter(
      (item): item is IPublicVideoProjection => isVideoProjection(item)
    );

    return combineLatest([
      this.publicPhotoAccess.hydratePublicPhotoUrls$(photoProjections),
      this.publicVideoAccess.hydratePublicVideoPreviews$(videoProjections),
    ]).pipe(
      map(([photos, videos]) => {
        const hydrated = new Map<string, IPublicProfileMediaItem>();

        for (const item of [...photos, ...videos]) {
          hydrated.set(buildHydratedIdentity(item), item);
        }

        const items = selected.projections.flatMap((projection) => {
          const item = hydrated.get(buildProjectionIdentity(projection));
          return item ? [item] : [];
        });

        return {
          items,
          photosCount: selected.photosCount,
          videosCount: selected.videosCount,
          totalCount: selected.totalCount,
        };
      })
    );
  }

  private countUniquePhotos(
    photos: readonly IPublicPhotoProjection[]
  ): number {
    return new Set(
      photos.map((photo) => String(photo.id ?? '').trim()).filter(Boolean)
    ).size;
  }

  private countUniqueVideos(
    videos: readonly IPublicVideoProjection[]
  ): number {
    return new Set(
      videos.map((video) => String(video.id ?? '').trim()).filter(Boolean)
    ).size;
  }

  private readMetricCount(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  private emptyPreview(): IPublicProfileMediaPreview {
    return {
      items: [],
      photosCount: 0,
      videosCount: 0,
      totalCount: 0,
    };
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao carregar prévia pública de mídias.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'MediaPublicPreviewQueryService',
        ...context,
      };
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // O diagnóstico não pode interromper a prévia pública.
    }
  }
}

function normalizePreviewLimit(value: unknown): number {
  const parsed = Math.floor(Number(value ?? DEFAULT_PREVIEW_LIMIT));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PREVIEW_LIMIT;
  }

  return Math.min(MAX_PREVIEW_LIMIT, parsed);
}

function isVideoProjection(
  item: PublicProfileMediaProjection
): item is IPublicVideoProjection {
  return item.mediaType === 'VIDEO';
}

function buildProjectionIdentity(item: PublicProfileMediaProjection): string {
  const id = String(item.id ?? '').trim();
  if (!id) return '';
  return `${isVideoProjection(item) ? 'VIDEO' : 'PHOTO'}:${id}`;
}

function buildHydratedIdentity(item: IPublicProfileMediaItem): string {
  const id = String(item.id ?? '').trim();
  if (!id) return '';
  return `${item.mediaType === 'VIDEO' ? 'VIDEO' : 'PHOTO'}:${id}`;
}

function compareProfileMediaProjection(
  left: PublicProfileMediaProjection,
  right: PublicProfileMediaProjection
): number {
  const leftCover = !isVideoProjection(left) && left.isCover === true ? 1 : 0;
  const rightCover = !isVideoProjection(right) && right.isCover === true ? 1 : 0;

  if (leftCover !== rightCover) {
    return rightCover - leftCover;
  }

  const orderDifference = safeNumber(left.orderIndex) - safeNumber(right.orderIndex);

  if (orderDifference !== 0) {
    return orderDifference;
  }

  const publishedDifference =
    safeNumber(right.publishedAt) - safeNumber(left.publishedAt);

  if (publishedDifference !== 0) {
    return publishedDifference;
  }

  return buildProjectionIdentity(left).localeCompare(buildProjectionIdentity(right));
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
