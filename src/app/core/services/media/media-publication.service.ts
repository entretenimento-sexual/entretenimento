// src/app/core/services/media/media-publication.service.ts
// Serviço da camada de publicação.
//
// OBJETIVO:
// - separar publicação da biblioteca privada
// - escrever config privada + projeção pública
// - manter Observable na API pública
// - usar FirestoreContextService para evitar chamadas fora do Injection Context
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { IPhotoItem } from 'src/app/core/interfaces/media/i-photo-item';
import {
  IPhotoPublicationConfig,
  TPhotoVisibility,
} from 'src/app/core/interfaces/media/i-photo-publication-config';

export interface IPublishPhotoCommand {
  ownerUid: string;
  photo: IPhotoItem;
  visibility: Exclude<TPhotoVisibility, 'PRIVATE'>;
  isCover?: boolean;
  orderIndex?: number;
  commentsEnabled?: boolean;
  reactionsEnabled?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MediaPublicationService {
  private readonly firestore = inject(Firestore);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  getPublicationConfigsByOwner$(
    ownerUid: string
  ): Observable<Record<string, IPhotoPublicationConfig>> {
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeOwnerUid) {
      return of({});
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicationCollection = collection(
        this.firestore,
        `users/${safeOwnerUid}/photo_publications`
      );

      return collectionData(publicationCollection, {
        idField: 'photoId',
      }) as Observable<IPhotoPublicationConfig[]>;
    }).pipe(
      map((items) =>
        items.reduce<Record<string, IPhotoPublicationConfig>>((acc, item) => {
          const safePhotoId = (item.photoId ?? '').trim();
          if (!safePhotoId) return acc;

          acc[safePhotoId] = {
            photoId: safePhotoId,
            ownerUid: item.ownerUid,
            isPublished: !!item.isPublished,
            visibility: item.visibility ?? 'PRIVATE',
            isCover: !!item.isCover,
            orderIndex: item.orderIndex ?? 0,
            commentsEnabled: item.commentsEnabled ?? false,
            reactionsEnabled: item.reactionsEnabled ?? false,
            publishedAt: item.publishedAt ?? null,
            updatedAt: item.updatedAt,
          };

          return acc;
        }, {})
      ),
      catchError((error) => {
        this.reportError(
          'Erro ao carregar configuração de publicação das fotos.',
          error,
          { op: 'getPublicationConfigsByOwner$', ownerUid: safeOwnerUid },
          true
        );
        return of({});
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  buildDefaultConfig(
    ownerUid: string,
    photoId: string
  ): IPhotoPublicationConfig {
    return {
      ownerUid: (ownerUid ?? '').trim(),
      photoId: (photoId ?? '').trim(),
      isPublished: false,
      visibility: 'PRIVATE',
      isCover: false,
      orderIndex: 0,
      commentsEnabled: false,
      reactionsEnabled: false,
      publishedAt: null,
    };
  }

  publishPhoto$(command: IPublishPhotoCommand): Observable<void> {
    const safeOwnerUid = (command.ownerUid ?? '').trim();
    const safePhotoId = (command.photo?.id ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const batch = writeBatch(this.firestore);
      const now = Date.now();

      const publicationRef = doc(
        this.firestore,
        `users/${safeOwnerUid}/photo_publications/${safePhotoId}`
      );

      batch.set(
        publicationRef,
        {
          ownerUid: safeOwnerUid,
          photoId: safePhotoId,
          isPublished: true,
          visibility: command.visibility,
          isCover: !!command.isCover,
          orderIndex: command.orderIndex ?? 0,
          commentsEnabled: command.commentsEnabled ?? false,
          reactionsEnabled: command.reactionsEnabled ?? false,
          publishedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      const publicRef = doc(
        this.firestore,
        `public_profiles/${safeOwnerUid}/photos/${safePhotoId}`
      );

      batch.set(
        publicRef,
        {
          id: safePhotoId,
          ownerUid: safeOwnerUid,
          url: command.photo.url,
          alt: command.photo.alt ?? command.photo.fileName ?? 'Foto do perfil',
          createdAt: command.photo.createdAt,
          publishedAt: now,
          updatedAt: now,
          visibility: command.visibility,
          isCover: !!command.isCover,
          orderIndex: command.orderIndex ?? 0,
          commentsEnabled: command.commentsEnabled ?? false,
          reactionsEnabled: command.reactionsEnabled ?? false,
        },
        { merge: true }
      );

      await batch.commit();
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao publicar a foto.',
          error,
          { op: 'publishPhoto$', command },
          false
        );
        return of(void 0);
      })
    );
  }

  unpublishPhoto$(ownerUid: string, privatePhotoId: string): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (privatePhotoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const batch = writeBatch(this.firestore);
      const now = Date.now();

      const publicationRef = doc(
        this.firestore,
        `users/${safeOwnerUid}/photo_publications/${safePhotoId}`
      );

      batch.set(
        publicationRef,
        {
          ownerUid: safeOwnerUid,
          photoId: safePhotoId,
          isPublished: false,
          visibility: 'PRIVATE',
          isCover: false,
          updatedAt: now,
        },
        { merge: true }
      );

      const publicRef = doc(
        this.firestore,
        `public_profiles/${safeOwnerUid}/photos/${safePhotoId}`
      );

      batch.delete(publicRef);

      await batch.commit();
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao despublicar a foto.',
          error,
          { op: 'unpublishPhoto$', ownerUid: safeOwnerUid, privatePhotoId: safePhotoId },
          false
        );
        return of(void 0);
      })
    );
  }

  setCoverPhoto$(ownerUid: string, privatePhotoId: string): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (privatePhotoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const publicationCollection = collection(
        this.firestore,
        `users/${safeOwnerUid}/photo_publications`
      );

      const publicationQuery = query(
        publicationCollection,
        where('isPublished', '==', true)
      );

      const snapshot = await getDocs(publicationQuery);
      const batch = writeBatch(this.firestore);
      const now = Date.now();

      snapshot.docs.forEach((docSnap) => {
        const isTarget = docSnap.id === safePhotoId;

        batch.set(
          docSnap.ref,
          {
            isCover: isTarget,
            updatedAt: now,
          },
          { merge: true }
        );

        const publicRef = doc(
          this.firestore,
          `public_profiles/${safeOwnerUid}/photos/${docSnap.id}`
        );

        batch.set(
          publicRef,
          {
            isCover: isTarget,
            updatedAt: now,
          },
          { merge: true }
        );
      });

      await batch.commit();
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao definir foto de capa.',
          error,
          { op: 'setCoverPhoto$', ownerUid: safeOwnerUid, privatePhotoId: safePhotoId },
          false
        );
        return of(void 0);
      })
    );
  }

  reorderPublishedPhotos$(
    ownerUid: string,
    orderedPhotoIds: string[]
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safeOrderedIds = (orderedPhotoIds ?? []).map((id) => (id ?? '').trim()).filter(Boolean);

    if (!safeOwnerUid || safeOrderedIds.length === 0) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const batch = writeBatch(this.firestore);
      const now = Date.now();

      safeOrderedIds.forEach((photoId, index) => {
        const publicationRef = doc(
          this.firestore,
          `users/${safeOwnerUid}/photo_publications/${photoId}`
        );

        batch.set(
          publicationRef,
          {
            ownerUid: safeOwnerUid,
            photoId,
            orderIndex: index,
            updatedAt: now,
          },
          { merge: true }
        );

        const publicRef = doc(
          this.firestore,
          `public_profiles/${safeOwnerUid}/photos/${photoId}`
        );

        batch.set(
          publicRef,
          {
            orderIndex: index,
            updatedAt: now,
          },
          { merge: true }
        );
      });

      await batch.commit();
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao reordenar fotos publicadas.',
          error,
          { op: 'reorderPublishedPhotos$', ownerUid: safeOwnerUid, orderedPhotoIds: safeOrderedIds },
          false
        );
        return of(void 0);
      })
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
        scope: 'MediaPublicationService',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = silent;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}