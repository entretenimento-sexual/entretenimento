// src/app/core/services/media/media-public-query.service.ts
// Leitura pública das fotos projetadas.
//
// OBJETIVO:
// - consumir SOMENTE a projeção pública
// - não usar a coleção privada users/{uid}/photos para exibição a terceiros
// - servir de base para:
//   1) galeria pública de um perfil
//   2) últimas fotos públicas de todos os usuários
//   3) fotos top
//   4) fotos turbinadas
//
// OBSERVAÇÃO:
// - usa a subcoleção public_photos para evitar conflito com collectionGroup('photos')
//   da camada privada.

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
import { catchError, map, shareReplay } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';

@Injectable({ providedIn: 'root' })
export class MediaPublicQueryService {
  private readonly firestore = inject(Firestore);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
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

      const q = query(
        publicPhotosCollection,
        where('visibility', '==', 'PUBLIC'),
        orderBy('orderIndex', 'asc'),
        orderBy('publishedAt', 'desc')
      );

      return collectionData(q, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoItem[]),
      catchError((error: unknown) => {
        this.reportError(
          'Erro ao carregar galeria pública do perfil.',
          error,
          { op: 'getProfilePublicPhotos$', ownerUid: safeOwnerUid },
          true
        );
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getLatestPublicPhotos$(takeCount = 24): Observable<IPublicPhotoItem[]> {
    return this.firestoreCtx.deferObservable$(() => {
      const cg = collectionGroup(this.firestore, 'public_photos');

      const q = query(
        cg,
        where('visibility', '==', 'PUBLIC'),
        orderBy('publishedAt', 'desc'),
        limit(takeCount)
      );

      return collectionData(q, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoItem[]),
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
      const cg = collectionGroup(this.firestore, 'public_photos');

      const q = query(
        cg,
        where('visibility', '==', 'PUBLIC'),
        orderBy('engagementScore', 'desc'),
        orderBy('publishedAt', 'desc'),
        limit(takeCount)
      );

      return collectionData(q, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoItem[]),
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

  getBoostedPublicPhotos$(takeCount = 24, nowMs = Date.now()): Observable<IPublicPhotoItem[]> {
    return this.firestoreCtx.deferObservable$(() => {
      const cg = collectionGroup(this.firestore, 'public_photos');

      const q = query(
        cg,
        where('visibility', '==', 'PUBLIC'),
        where('boostActive', '==', true),
        where('boostedUntil', '>', nowMs),
        orderBy('boostedUntil', 'desc'),
        limit(takeCount)
      );

      return collectionData(q, { idField: 'id' });
    }).pipe(
      map((items) => items as IPublicPhotoItem[]),
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