// src/app/core/services/media/media-public-query.service.ts
// Leitura das projeções públicas de fotos e vídeos.
//
// Segurança:
// - consome somente public_profiles/{uid}/public_photos e public_videos;
// - não usa bibliotecas privadas para exibição a terceiros;
// - projeções Firestore não precisam conter URLs permanentes;
// - URLs temporárias são emitidas pelo backend e mantidas apenas em memória.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  collectionGroup,
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
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import { PublicVideoAccessService } from './public-video-access.service';
import { mapPublicVideoProjection } from './public-video-item.mapper';

export interface MediaPublicProfileQueryOptions {
  propagateErrors?: boolean;
}

const PUBLIC_MEDIA_OWNER_FILTER_LIMIT = 30;
const PUBLIC_MEDIA_BATCH_LIMIT = 60;
const SAFE_PUBLIC_MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

@Injectable({ providedIn: 'root' })
export class MediaPublicQueryService {
  private readonly firestore = inject(Firestore);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly publicPhotoAccess: PublicPhotoAccessService,
    private readonly publicVideoAccess: PublicVideoAccessService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  getProfilePublicMedia$(
    ownerUid: string,
    options: MediaPublicProfileQueryOptions = {}
  ): Observable<IPublicProfileMediaItem[]> {
    return combineLatest([
      this.getProfilePublicPhotos$(ownerUid, options),
      this.getProfilePublicVideos$(ownerUid, options),
    ]).pipe(
      map(([photos, videos]) =>
        [...photos, ...videos].sort((left, right) =>
          this.compareProfileMedia(left, right)
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getProfilePublicPhotos$(
    ownerUid: string,
    options: MediaPublicProfileQueryOptions = {}
  ): Observable<IPublicPhotoItem[]> {
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeOwnerUid) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicPhotosCollection = collection(
        this.firestore,
        `public_profiles/${safeOwnerUid}/public_photos`
      );

      const publicPhotosQuery = query(
        publicPhotosCollection,
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('orderIndex', 'asc'),
        orderBy('publishedAt', 'desc')
      );

      return collectionData(publicPhotosQuery, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoProjection[]),
      switchMap((items) =>
        this.publicPhotoAccess.hydratePublicPhotoUrls$(items)
      ),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar fotos públicas do perfil.',
          error,
          { op: 'getProfilePublicPhotos$', ownerUid: safeOwnerUid },
          true
        );

        return options.propagateErrors
          ? throwError(() => error)
          : of([] as IPublicPhotoItem[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getProfilePublicVideos$(
    ownerUid: string,
    options: MediaPublicProfileQueryOptions = {}
  ): Observable<IPublicVideoItem[]> {
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeOwnerUid) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicVideosCollection = collection(
        this.firestore,
        `public_profiles/${safeOwnerUid}/public_videos`
      );

      const publicVideosQuery = query(
        publicVideosCollection,
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('orderIndex', 'asc'),
        orderBy('publishedAt', 'desc')
      );

      return collectionData(publicVideosQuery, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicVideoProjection[]),
      switchMap((items) =>
        this.publicVideoAccess.hydratePublicVideoUrls$(items)
      ),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar vídeos públicos do perfil.',
          error,
          { op: 'getProfilePublicVideos$', ownerUid: safeOwnerUid },
          true
        );

        return options.propagateErrors
          ? throwError(() => error)
          : of([] as IPublicVideoItem[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Lê publicações recentes de um conjunto pequeno de proprietários em uma
   * única collection-group query. O objetivo é alimentar superfícies pessoais
   * (amigos + compatíveis) sem uma consulta Firestore por autor.
   */
  getRecentPublicPhotosByOwners$(
    ownerUids: readonly string[],
    takeCount = 36,
    options: MediaPublicProfileQueryOptions = {}
  ): Observable<IPublicPhotoItem[]> {
    const safeOwnerUids = this.normalizeOwnerUids(ownerUids);
    const safeTakeCount = this.normalizeBatchLimit(takeCount, 36);

    if (!safeOwnerUids.length) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicPhotosGroup = collectionGroup(
        this.firestore,
        'public_photos'
      );
      const publicPhotosQuery = query(
        publicPhotosGroup,
        where('ownerUid', 'in', safeOwnerUids),
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('publishedAt', 'desc'),
        limit(safeTakeCount)
      );

      return collectionData(publicPhotosQuery, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoProjection[]),
      switchMap((items) =>
        this.publicPhotoAccess.hydratePublicPhotoUrls$(items)
      ),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar fotos pessoais públicas.',
          error,
          {
            op: 'getRecentPublicPhotosByOwners$',
            ownerCount: safeOwnerUids.length,
            takeCount: safeTakeCount,
          },
          true
        );

        return options.propagateErrors
          ? throwError(() => error)
          : of([] as IPublicPhotoItem[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Equivalente em vídeo para o feed pessoal. Hidrata somente previews:
   * poster temporário pode chegar ao card, mas a URL de playback continua nula
   * até o usuário abrir o viewer.
   */
  getRecentPublicVideoPreviewsByOwners$(
    ownerUids: readonly string[],
    takeCount = 24,
    options: MediaPublicProfileQueryOptions = {}
  ): Observable<IPublicVideoItem[]> {
    const safeOwnerUids = this.normalizeOwnerUids(ownerUids);
    const safeTakeCount = this.normalizeBatchLimit(takeCount, 24);

    if (!safeOwnerUids.length) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicVideosGroup = collectionGroup(
        this.firestore,
        'public_videos'
      );
      const publicVideosQuery = query(
        publicVideosGroup,
        where('ownerUid', 'in', safeOwnerUids),
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('publishedAt', 'desc'),
        limit(safeTakeCount)
      );

      return collectionData(publicVideosQuery, { idField: 'id' });
    }).pipe(
      map((items) =>
        items.flatMap((item) => {
          const source = item as Record<string, unknown>;
          const projection = mapPublicVideoProjection({
            documentId: source['id'],
            data: source,
          });
          return projection ? [projection] : [];
        })
      ),
      switchMap((items) =>
        this.publicVideoAccess.hydratePublicVideoPreviews$(items)
      ),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar vídeos pessoais públicos.',
          error,
          {
            op: 'getRecentPublicVideoPreviewsByOwners$',
            ownerCount: safeOwnerUids.length,
            takeCount: safeTakeCount,
          },
          true
        );

        return options.propagateErrors
          ? throwError(() => error)
          : of([] as IPublicVideoItem[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Consulta reativa de um único vídeo público por identidade canônica.
   *
   * Usada por deep links para evitar o caminho antigo:
   * 1) ler toda a galeria do perfil;
   * 2) emitir URLs assinadas para todos os vídeos;
   * 3) descartar tudo, exceto o vídeo solicitado.
   *
   * A leitura direta usa as Rules como fronteira para PUBLIC + APPROVED.
   * `permission-denied` é normalizado como indisponibilidade para não revelar
   * se o vídeo foi privado, removido ou reprovado. O deep link hidrata somente
   * o preview; a URL do ativo de vídeo é promovida pelo viewer ao ser aberto.
   */
  getPublicVideoById$(
    ownerUid: string,
    videoId: string,
    options: MediaPublicProfileQueryOptions = {}
  ): Observable<IPublicVideoItem | null> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safeVideoId = (videoId ?? '').trim();

    if (!safeOwnerUid || !safeVideoId) {
      return of(null);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicVideoRef = doc(
        this.firestore,
        `public_profiles/${safeOwnerUid}/public_videos/${safeVideoId}`
      );

      return docData(publicVideoRef, { idField: 'id' });
    }).pipe(
      map((item) => item ? item as IPublicVideoProjection : null),
      switchMap((projection) => {
        if (!projection) {
          return of(null);
        }

        return this.publicVideoAccess
          .hydratePublicVideoPreviews$([projection])
          .pipe(map((items) => items[0] ?? null));
      }),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar vídeo público do perfil.',
          error,
          {
            op: 'getPublicVideoById$',
            ownerUid: safeOwnerUid,
            videoId: safeVideoId,
          },
          true
        );

        if (this.isPermissionDenied(error)) {
          return of(null);
        }

        return options.propagateErrors
          ? throwError(() => error)
          : of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getLatestPublicPhotos$(takeCount = 24): Observable<IPublicPhotoItem[]> {
    return this.firestoreCtx.deferObservable$(() => {
      const publicPhotosGroup = collectionGroup(
        this.firestore,
        'public_photos'
      );

      const latestPhotosQuery = query(
        publicPhotosGroup,
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('publishedAt', 'desc'),
        limit(takeCount)
      );

      return collectionData(latestPhotosQuery, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoProjection[]),
      switchMap((items) =>
        this.publicPhotoAccess.hydratePublicPhotoUrls$(items)
      ),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar últimas fotos públicas.',
          error,
          { op: 'getLatestPublicPhotos$', takeCount },
          true
        );
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getTopPublicPhotos$(takeCount = 24): Observable<IPublicPhotoItem[]> {
    return this.firestoreCtx.deferObservable$(() => {
      const publicPhotosGroup = collectionGroup(
        this.firestore,
        'public_photos'
      );

      const topPhotosQuery = query(
        publicPhotosGroup,
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('score', 'desc'),
        orderBy('publishedAt', 'desc'),
        limit(takeCount)
      );

      return collectionData(topPhotosQuery, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoProjection[]),
      switchMap((items) =>
        this.publicPhotoAccess.hydratePublicPhotoUrls$(items)
      ),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar fotos em destaque.',
          error,
          { op: 'getTopPublicPhotos$', takeCount },
          true
        );
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getBoostedPublicPhotos$(
    takeCount = 24,
    nowMs = Date.now()
  ): Observable<IPublicPhotoItem[]> {
    return this.firestoreCtx.deferObservable$(() => {
      const publicPhotosGroup = collectionGroup(
        this.firestore,
        'public_photos'
      );

      const boostedPhotosQuery = query(
        publicPhotosGroup,
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        where('boostActive', '==', true),
        where('boostedUntil', '>', nowMs),
        orderBy('boostedUntil', 'desc'),
        limit(takeCount)
      );

      return collectionData(boostedPhotosQuery, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoProjection[]),
      switchMap((items) =>
        this.publicPhotoAccess.hydratePublicPhotoUrls$(items)
      ),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar fotos turbinadas.',
          error,
          { op: 'getBoostedPublicPhotos$', takeCount, nowMs },
          true
        );
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private compareProfileMedia(
    left: IPublicProfileMediaItem,
    right: IPublicProfileMediaItem
  ): number {
    const leftCover = 'isCover' in left && left.isCover === true ? 1 : 0;
    const rightCover = 'isCover' in right && right.isCover === true ? 1 : 0;

    if (leftCover !== rightCover) {
      return rightCover - leftCover;
    }

    const orderDifference = this.safeNumber(left.orderIndex) -
      this.safeNumber(right.orderIndex);

    if (orderDifference !== 0) {
      return orderDifference;
    }

    return this.safeNumber(right.publishedAt) -
      this.safeNumber(left.publishedAt);
  }

  private normalizeOwnerUids(values: readonly string[]): string[] {
    const unique = new Set<string>();

    for (const value of values ?? []) {
      const uid = String(value ?? '').trim();
      if (!SAFE_PUBLIC_MEDIA_ID_PATTERN.test(uid)) {
        continue;
      }

      unique.add(uid);
      if (unique.size >= PUBLIC_MEDIA_OWNER_FILTER_LIMIT) {
        break;
      }
    }

    return [...unique];
  }

  private normalizeBatchLimit(value: unknown, fallback: number): number {
    const parsed = Math.floor(Number(value));
    const normalized = Number.isFinite(parsed) && parsed > 0
      ? parsed
      : fallback;

    return Math.min(normalized, PUBLIC_MEDIA_BATCH_LIMIT);
  }

  private safeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : 0;
  }

  private isPermissionDenied(error: unknown): boolean {
    const code = String(
      (error as { code?: unknown } | null)?.code ?? ''
    ).trim().toLowerCase();

    return code === 'permission-denied' || code.endsWith('/permission-denied');
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>,
    silent = false
  ): void {
    if (!silent) {
      try {
        this.errorNotifier.showError(userMessage);
      } catch {
        // noop
      }
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'MediaPublicQueryService',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = silent;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}
