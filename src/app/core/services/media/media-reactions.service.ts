// src/app/core/services/media/media-reactions.service.ts
// Reações reais do domínio Media.
//
// AJUSTES DESTA VERSÃO:
// - deixa de ser no-op
// - usa Firestore real com subcoleção likes
// - expõe contagem reativa
// - expõe estado "curtido pelo usuário atual"
// - toggle real com setDoc/deleteDoc
//
// OBSERVAÇÃO:
// - pelas regras atuais e pela policy atual de fotos, as reações continuam owner-only.
// - isso é coerente com o estado atual do domínio.

import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, deleteDoc, doc, docData, setDoc } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, take } from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class MediaReactionsService {
  private readonly firestore = inject(Firestore);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  getPhotoLikesCount$(ownerUid: string, photoId: string): Observable<number> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(0);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const likesCollection = collection(
        this.firestore,
        `users/${safeOwnerUid}/photos/${safePhotoId}/likes`
      );

      return collectionData(likesCollection, { idField: 'id' }).pipe(
        map((items) => items.length)
      );
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao carregar curtidas da foto.',
          error,
          { op: 'getPhotoLikesCount$', ownerUid: safeOwnerUid, photoId: safePhotoId },
          true
        );
        return of(0);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  isPhotoLikedByViewer$(
    ownerUid: string,
    photoId: string,
    viewerUid: string | null
  ): Observable<boolean> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();
    const safeViewerUid = (viewerUid ?? '').trim();

    if (!safeOwnerUid || !safePhotoId || !safeViewerUid) {
      return of(false);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const likeDocRef = doc(
        this.firestore,
        `users/${safeOwnerUid}/photos/${safePhotoId}/likes/${safeViewerUid}`
      );

      return docData(likeDocRef, { idField: 'id' }).pipe(
        map((value) => !!value)
      );
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao verificar curtida da foto.',
          error,
          { op: 'isPhotoLikedByViewer$', ownerUid: safeOwnerUid, photoId: safePhotoId, viewerUid: safeViewerUid },
          true
        );
        return of(false);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  toggleLikePhoto$(
    ownerUid: string,
    photoId: string,
    viewerUid: string | null
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();
    const safeViewerUid = (viewerUid ?? '').trim();

    if (!safeOwnerUid || !safePhotoId || !safeViewerUid) {
      return of(void 0);
    }

    return this.isPhotoLikedByViewer$(safeOwnerUid, safePhotoId, safeViewerUid).pipe(
      take(1),
      switchMap((liked) => {
        const likeDocRef = doc(
          this.firestore,
          `users/${safeOwnerUid}/photos/${safePhotoId}/likes/${safeViewerUid}`
        );

        return this.firestoreCtx.deferPromise$(() => {
          if (liked) {
            return deleteDoc(likeDocRef);
          }

          return setDoc(likeDocRef, {
            uid: safeViewerUid,
            createdAt: new Date(),
          });
        }).pipe(
          map(() => void 0)
        );
      }),
      catchError((error) => {
        this.reportError(
          'Erro ao atualizar curtida da foto.',
          error,
          { op: 'toggleLikePhoto$', ownerUid: safeOwnerUid, photoId: safePhotoId, viewerUid: safeViewerUid },
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
        scope: 'MediaReactionsService',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = silent;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}