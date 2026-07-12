// src/app/core/services/media/media-public-query.service.ts
// Leitura pública das fotos projetadas.
//
// Segurança:
// - consome somente public_profiles/{uid}/public_photos;
// - não usa users/{uid}/photos para exibição a terceiros;
// - a projeção Firestore não precisa conter URL permanente;
// - URLs temporárias são emitidas por backend e mantidas apenas em memória.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  collectionGroup,
  limit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import {
  catchError,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicPhotoAccessService } from './public-photo-access.service';

@Injectable({ providedIn: 'root' })
export class MediaPublicQueryService {
  private readonly firestore = inject(Firestore);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly publicPhotoAccess: PublicPhotoAccessService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  getProfilePublicPhotos$(ownerUid: string): Observable<IPublicPhotoItem[]> {
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
          'Não foi possível carregar as fotos deste perfil agora.',
          error,
          { op: 'getProfilePublicPhotos$', ownerUid: safeOwnerUid }
        );
        return of([]);
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
