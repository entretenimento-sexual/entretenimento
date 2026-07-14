// src/app/core/services/media/media-reactions.service.ts
// Reações públicas de fotos e vídeos.
//
// Segurança:
// - o cliente lê apenas contadores e o próprio subdocumento de curtida;
// - criação, remoção, contagem e score passam por Callables autenticadas;
// - nenhuma coleção privada de mídia é usada para interação pública.

import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

interface ToggleReactionRequest {
  ownerUid: string;
  photoId?: string;
  videoId?: string;
}

interface ToggleReactionResponse {
  liked: boolean;
  reactionsCount: number;
  score: number;
}

interface PublicReactionProjection {
  reactionsCount?: number;
  likesCount?: number;
}

type PublicMediaKind = 'photo' | 'video';

@Injectable({ providedIn: 'root' })
export class MediaReactionsService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly togglePhotoReactionCallable = httpsCallable<
    ToggleReactionRequest,
    ToggleReactionResponse
  >(this.functions, 'togglePhotoReaction');
  private readonly toggleVideoReactionCallable = httpsCallable<
    ToggleReactionRequest,
    ToggleReactionResponse
  >(this.functions, 'toggleVideoReaction');

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  getPhotoLikesCount$(ownerUid: string, photoId: string): Observable<number> {
    return this.getLikesCount$('photo', ownerUid, photoId);
  }

  getVideoLikesCount$(ownerUid: string, videoId: string): Observable<number> {
    return this.getLikesCount$('video', ownerUid, videoId);
  }

  isPhotoLikedByViewer$(
    ownerUid: string,
    photoId: string,
    viewerUid: string | null
  ): Observable<boolean> {
    return this.isLikedByViewer$('photo', ownerUid, photoId, viewerUid);
  }

  isVideoLikedByViewer$(
    ownerUid: string,
    videoId: string,
    viewerUid: string | null
  ): Observable<boolean> {
    return this.isLikedByViewer$('video', ownerUid, videoId, viewerUid);
  }

  toggleLikePhoto$(
    ownerUid: string,
    photoId: string,
    viewerUid: string | null
  ): Observable<void> {
    return this.toggleLike$('photo', ownerUid, photoId, viewerUid);
  }

  toggleLikeVideo$(
    ownerUid: string,
    videoId: string,
    viewerUid: string | null
  ): Observable<void> {
    return this.toggleLike$('video', ownerUid, videoId, viewerUid);
  }

  private getLikesCount$(
    kind: PublicMediaKind,
    ownerUid: string,
    mediaId: string
  ): Observable<number> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safeMediaId = this.cleanId(mediaId);

    if (!safeOwnerUid || !safeMediaId) {
      return of(0);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const mediaRef = doc(
        this.firestore,
        this.publicMediaPath(kind, safeOwnerUid, safeMediaId)
      );

      return docData(mediaRef).pipe(
        map((value) => {
          const media = value as PublicReactionProjection | undefined;
          return this.normalizeCount(
            media?.reactionsCount ?? media?.likesCount ?? 0
          );
        })
      );
    }).pipe(
      catchError((error) => {
        this.reportError(
          `Erro ao carregar curtidas do ${this.kindLabel(kind)}.`,
          error,
          {
            op: 'getLikesCount$',
            kind,
            hasOwnerUid: !!safeOwnerUid,
            hasMediaId: !!safeMediaId,
          },
          true
        );
        return of(0);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private isLikedByViewer$(
    kind: PublicMediaKind,
    ownerUid: string,
    mediaId: string,
    viewerUid: string | null
  ): Observable<boolean> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safeMediaId = this.cleanId(mediaId);
    const safeViewerUid = this.cleanId(viewerUid);

    if (!safeOwnerUid || !safeMediaId || !safeViewerUid) {
      return of(false);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const likeRef = doc(
        this.firestore,
        `${this.publicMediaPath(kind, safeOwnerUid, safeMediaId)}/likes/${safeViewerUid}`
      );

      return docData(likeRef).pipe(map((value) => !!value));
    }).pipe(
      catchError((error) => {
        this.reportError(
          `Erro ao verificar curtida do ${this.kindLabel(kind)}.`,
          error,
          {
            op: 'isLikedByViewer$',
            kind,
            hasOwnerUid: !!safeOwnerUid,
            hasMediaId: !!safeMediaId,
            hasViewerUid: !!safeViewerUid,
          },
          true
        );
        return of(false);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private toggleLike$(
    kind: PublicMediaKind,
    ownerUid: string,
    mediaId: string,
    viewerUid: string | null
  ): Observable<void> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safeMediaId = this.cleanId(mediaId);
    const safeViewerUid = this.cleanId(viewerUid);

    if (!safeOwnerUid || !safeMediaId || !safeViewerUid) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = kind === 'photo'
        ? this.togglePhotoReactionCallable
        : this.toggleVideoReactionCallable;
      const payload: ToggleReactionRequest = {
        ownerUid: safeOwnerUid,
        ...(kind === 'photo'
          ? { photoId: safeMediaId }
          : { videoId: safeMediaId }),
      };

      await callable(payload);
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          `Erro ao atualizar curtida do ${this.kindLabel(kind)}.`,
          error,
          {
            op: 'toggleLike$',
            kind,
            hasOwnerUid: !!safeOwnerUid,
            hasMediaId: !!safeMediaId,
            hasViewerUid: !!safeViewerUid,
          }
        );
        return of(void 0);
      })
    );
  }

  private publicMediaPath(
    kind: PublicMediaKind,
    ownerUid: string,
    mediaId: string
  ): string {
    const collectionName = kind === 'photo' ? 'public_photos' : 'public_videos';
    return `public_profiles/${ownerUid}/${collectionName}/${mediaId}`;
  }

  private kindLabel(kind: PublicMediaKind): string {
    return kind === 'photo' ? 'foto' : 'vídeo';
  }

  private cleanId(value: string | null | undefined): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private normalizeCount(value: unknown): number {
    const count = Number(value ?? 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>,
    silent = false
  ): void {
    if (!silent) {
      this.errorNotifier.showError(userMessage);
    }

    try {
      const normalized = error instanceof Error
        ? error
        : new Error(userMessage);
      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'MediaReactionsService',
        ...(context ?? {}),
      };
      (normalized as any).skipUserNotification = silent;
      this.errorHandler.handleError(normalized);
      this.privacyDebug.log('media', 'MediaReactionsService: falha', context);
    } catch {
      // noop
    }
  }
}
