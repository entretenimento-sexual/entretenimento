// src/app/core/services/media/media-photo-comments.service.ts
// Service de comentários públicos em fotos.
//
// Objetivo:
// - listar comentários visíveis de uma foto pública;
// - criar comentário apenas quando a foto permite comentários;
// - preparar moderação futura;
// - manter Observable na API pública;
// - centralizar erro no GlobalErrorHandlerService;
// - evitar logs/dados sensíveis.

import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  doc,
  getDoc,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { IPhotoComment } from 'src/app/core/interfaces/media/i-photo-comment';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';

export interface ICreatePhotoCommentCommand {
  ownerUid: string;
  photoId: string;
  authorUid: string;
  authorNickname: string;
  content: string;
}

@Injectable({ providedIn: 'root' })
export class MediaPhotoCommentsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  watchVisibleComments$(
    ownerUid: string,
    photoId: string,
    takeCount = 30
  ): Observable<IPhotoComment[]> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safePhotoId = this.cleanId(photoId);
    const safeTakeCount = Math.max(1, Math.min(100, Math.floor(takeCount || 30)));

    if (!safeOwnerUid || !safePhotoId) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const commentsCollection = collection(
        this.firestore,
        this.commentsPath(safeOwnerUid, safePhotoId)
      );

      const q = query(
        commentsCollection,
        where('status', '==', 'VISIBLE'),
        orderBy('createdAt', 'asc'),
        limit(safeTakeCount)
      );

      return collectionData(q, { idField: 'id' }) as Observable<IPhotoComment[]>;
    }).pipe(
      map((items) =>
        items.map((item) => this.normalizeComment(item, safeOwnerUid, safePhotoId))
      ),
      catchError((error) => {
        this.reportError(
          'Erro ao carregar comentários da foto.',
          error,
          {
            op: 'watchVisibleComments$',
            hasOwnerUid: !!safeOwnerUid,
            hasPhotoId: !!safePhotoId,
          },
          true
        );

        return of([]);
      })
    );
  }

  createComment$(command: ICreatePhotoCommentCommand): Observable<string | null> {
    const safeOwnerUid = this.cleanId(command.ownerUid);
    const safePhotoId = this.cleanId(command.photoId);
    const safeAuthorUid = this.cleanId(command.authorUid);
    const safeNickname = this.cleanNickname(command.authorNickname);
    const safeContent = this.cleanCommentContent(command.content);

    if (!safeOwnerUid || !safePhotoId || !safeAuthorUid || !safeContent) {
      this.errorNotifier.showWarning('Comentário inválido.');
      return of(null);
    }

    if (this.auth.currentUser?.uid !== safeAuthorUid) {
      this.errorNotifier.showError('Sessão inválida para comentar.');
      return of(null);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const photoRef = doc(
        this.firestore,
        `public_profiles/${safeOwnerUid}/public_photos/${safePhotoId}`
      );

      const photoSnap = await getDoc(photoRef);

      if (!photoSnap.exists()) {
        throw new Error('Foto pública não encontrada.');
      }

      const photo = photoSnap.data() as IPublicPhotoItem;

      if (photo.visibility !== 'PUBLIC') {
        throw new Error('Esta foto não está pública.');
      }

      if (photo.moderationStatus !== 'APPROVED') {
        throw new Error('Esta foto ainda não está aprovada para comentários.');
      }

      if (photo.commentsEnabled !== true) {
        throw new Error('Comentários desabilitados nesta foto.');
      }

      if (photo.commentsPolicy !== 'EVERYONE') {
        throw new Error('A política atual da foto não permite comentários públicos.');
      }

      const now = Date.now();

      const commentsCollection = collection(
        this.firestore,
        this.commentsPath(safeOwnerUid, safePhotoId)
      );

      const created = await addDoc(commentsCollection, {
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,

        authorUid: safeAuthorUid,
        authorNickname: safeNickname,

        content: safeContent,

        status: 'VISIBLE',

        likesCount: 0,
        reportsCount: 0,

        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } satisfies Omit<IPhotoComment, 'id'>);

      this.debug('comment created', {
        hasOwnerUid: !!safeOwnerUid,
        hasPhotoId: !!safePhotoId,
        hasAuthorUid: !!safeAuthorUid,
      });

      return created.id;
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao publicar comentário.',
          error,
          {
            op: 'createComment$',
            hasOwnerUid: !!safeOwnerUid,
            hasPhotoId: !!safePhotoId,
            hasAuthorUid: !!safeAuthorUid,
          },
          false
        );

        return of(null);
      })
    );
  }

  softDeleteComment$(
    ownerUid: string,
    photoId: string,
    commentId: string,
    requesterUid: string
  ): Observable<void> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safePhotoId = this.cleanId(photoId);
    const safeCommentId = this.cleanId(commentId);
    const safeRequesterUid = this.cleanId(requesterUid);

    if (!safeOwnerUid || !safePhotoId || !safeCommentId || !safeRequesterUid) {
      return of(void 0);
    }

    if (this.auth.currentUser?.uid !== safeRequesterUid) {
      this.errorNotifier.showError('Sessão inválida para remover comentário.');
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const commentRef = doc(
        this.firestore,
        `${this.commentsPath(safeOwnerUid, safePhotoId)}/${safeCommentId}`
      );

      const snap = await getDoc(commentRef);

      if (!snap.exists()) {
        return;
      }

      const comment = snap.data() as IPhotoComment;
      const canDelete =
        comment.authorUid === safeRequesterUid || safeOwnerUid === safeRequesterUid;

      if (!canDelete) {
        throw new Error('Você não tem permissão para remover este comentário.');
      }

      const now = Date.now();

      await updateDoc(commentRef, {
        status: 'DELETED',
        content: '',
        updatedAt: now,
        deletedAt: now,
      });

      this.debug('comment soft deleted', {
        hasOwnerUid: !!safeOwnerUid,
        hasPhotoId: !!safePhotoId,
        hasCommentId: !!safeCommentId,
      });
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao remover comentário.',
          error,
          {
            op: 'softDeleteComment$',
            hasOwnerUid: !!safeOwnerUid,
            hasPhotoId: !!safePhotoId,
            hasCommentId: !!safeCommentId,
          },
          false
        );

        return of(void 0);
      })
    );
  }

  private commentsPath(ownerUid: string, photoId: string): string {
    return `public_profiles/${ownerUid}/public_photos/${photoId}/comments`;
  }

  private cleanId(value: string | null | undefined): string {
    return String(value ?? '').trim();
  }

  private cleanNickname(value: string | null | undefined): string {
    const text = String(value ?? '').trim();

    if (!text) {
      return 'Usuário';
    }

    return text.slice(0, 40);
  }

  private cleanCommentContent(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 500);
  }

  private normalizeComment(
    item: IPhotoComment,
    ownerUid: string,
    photoId: string
  ): IPhotoComment {
    return {
      id: item.id,
      ownerUid: item.ownerUid || ownerUid,
      photoId: item.photoId || photoId,

      authorUid: item.authorUid,
      authorNickname: item.authorNickname || 'Usuário',

      content: item.content || '',

      status: item.status ?? 'VISIBLE',

      likesCount: item.likesCount ?? 0,
      reportsCount: item.reportsCount ?? 0,

      createdAt: item.createdAt ?? 0,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt ?? null,
    };
  }

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log('media', `MediaPhotoCommentsService: ${message}`, extra);
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
        scope: 'MediaPhotoCommentsService',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = silent;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}