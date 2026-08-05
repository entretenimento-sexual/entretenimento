// src/app/core/services/media/media-public-query.service.ts
// Leitura autorizada das projeções públicas de fotos e vídeos.
//
// Segurança:
// - fotos e vídeos passam pelo backend antes de expor metadados;
// - visitante, autor, bloqueios e publicação canônica são reavaliados;
// - projeções não contêm URLs permanentes;
// - URLs temporárias são emitidas pelo backend e mantidas apenas em memória.

import { Injectable } from '@angular/core';
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
} from 'src/app/core/interfaces/media/i-public-photo-item';
import {
  IPublicVideoItem,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import { PublicPhotoAudienceQueryService } from './public-photo-audience-query.service';
import { PublicVideoAccessService } from './public-video-access.service';
import { PublicVideoAudienceQueryService } from './public-video-audience-query.service';

export interface MediaPublicProfileQueryOptions {
  propagateErrors?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MediaPublicQueryService {
  constructor(
    private readonly publicPhotoAccess: PublicPhotoAccessService,
    private readonly publicPhotoAudienceQuery: PublicPhotoAudienceQueryService,
    private readonly publicVideoAccess: PublicVideoAccessService,
    private readonly publicVideoAudienceQuery: PublicVideoAudienceQueryService,
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

    return this.publicPhotoAudienceQuery
      .loadProfilePhotos$(safeOwnerUid)
      .pipe(
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

    return this.publicVideoAudienceQuery
      .loadProfileVideos$(safeOwnerUid)
      .pipe(
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

  getLatestPublicPhotos$(takeCount = 24): Observable<IPublicPhotoItem[]> {
    return this.publicPhotoAudienceQuery
      .loadPublicPhotos$('latest', takeCount)
      .pipe(
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
          return of([] as IPublicPhotoItem[]);
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
  }

  getTopPublicPhotos$(takeCount = 24): Observable<IPublicPhotoItem[]> {
    return this.publicPhotoAudienceQuery
      .loadPublicPhotos$('top', takeCount)
      .pipe(
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
          return of([] as IPublicPhotoItem[]);
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
  }

  getBoostedPublicPhotos$(
    takeCount = 24,
    nowMs = Date.now()
  ): Observable<IPublicPhotoItem[]> {
    return this.publicPhotoAudienceQuery
      .loadPublicPhotos$('boosted', takeCount, nowMs)
      .pipe(
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
          return of([] as IPublicPhotoItem[]);
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

  private safeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : 0;
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
