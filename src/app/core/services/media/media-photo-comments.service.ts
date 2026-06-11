// src/app/core/services/media/media-photo-comments.service.ts
// Service de comentários públicos em fotos.
//
// Objetivo:
// - listar comentários visíveis de uma foto pública;
// - criar comentário via Callable segura;
// - responder comentário via Callable segura;
// - moderar comentário via Callable segura;
// - manter Observable na API pública;
// - centralizar erro no GlobalErrorHandlerService;
// - evitar logs/dados sensíveis.
//
// Segurança:
// - cliente não grava comentário direto;
// - cliente não atualiza commentsCount/score;
// - cliente não modera por updateDoc;
// - backend valida Auth, foto pública/aprovada, política e dono da foto.
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { IPhotoComment, TPhotoCommentStatus } from 'src/app/core/interfaces/media/i-photo-comment';

export interface ICreatePhotoCommentCommand {
  ownerUid: string;
  photoId: string;
  authorUid?: string;
  authorNickname?: string;
  content: string;
}

export interface IReplyToPhotoCommentCommand {
  ownerUid: string;
  photoId: string;
  parentCommentId: string;
  content: string;
}

export type TModeratePhotoCommentAction = 'HIDE' | 'RESTORE' | 'DELETE';

interface CreatePhotoCommentCallableRequest {
  ownerUid: string;
  photoId: string;
  content: string;
  parentCommentId?: string | null;
}

interface CreatePhotoCommentCallableResponse {
  commentId: string;
}

interface ModeratePhotoCommentCallableRequest {
  ownerUid: string;
  photoId: string;
  commentId: string;
  action: TModeratePhotoCommentAction;
}

interface ModeratePhotoCommentCallableResponse {
  status: TPhotoCommentStatus;
  commentsCount: number;
  score: number;
}

@Injectable({ providedIn: 'root' })
export class MediaPhotoCommentsService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);

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

  /**
   * Cria comentário via Callable.
   *
   * Mantém a assinatura anterior para reduzir impacto no PhotoViewer.
   * authorUid/authorNickname ficam aceitos por compatibilidade, mas a autoridade
   * passa a ser o backend autenticado.
   */
  createComment$(command: ICreatePhotoCommentCommand): Observable<string | null> {
    const safeOwnerUid = this.cleanId(command.ownerUid);
    const safePhotoId = this.cleanId(command.photoId);
    const safeContent = this.cleanCommentContent(command.content);

    if (!safeOwnerUid || !safePhotoId || !safeContent) {
      this.errorNotifier.showWarning('Comentário inválido.');
      return of(null);
    }

    return this.callCreateComment$({
      ownerUid: safeOwnerUid,
      photoId: safePhotoId,
      content: safeContent,
      parentCommentId: null,
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao publicar comentário.',
          error,
          {
            op: 'createComment$',
            hasOwnerUid: !!safeOwnerUid,
            hasPhotoId: !!safePhotoId,
          },
          false
        );

        return of(null);
      })
    );
  }

  /**
   * Resposta do dono da foto a um comentário.
   *
   * O backend valida se o usuário autenticado é o dono da foto.
   */
  replyToComment$(command: IReplyToPhotoCommentCommand): Observable<string | null> {
    const safeOwnerUid = this.cleanId(command.ownerUid);
    const safePhotoId = this.cleanId(command.photoId);
    const safeParentCommentId = this.cleanId(command.parentCommentId);
    const safeContent = this.cleanCommentContent(command.content);

    if (!safeOwnerUid || !safePhotoId || !safeParentCommentId || !safeContent) {
      this.errorNotifier.showWarning('Resposta inválida.');
      return of(null);
    }

    return this.callCreateComment$({
      ownerUid: safeOwnerUid,
      photoId: safePhotoId,
      content: safeContent,
      parentCommentId: safeParentCommentId,
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao responder comentário.',
          error,
          {
            op: 'replyToComment$',
            hasOwnerUid: !!safeOwnerUid,
            hasPhotoId: !!safePhotoId,
            hasParentCommentId: !!safeParentCommentId,
          },
          false
        );

        return of(null);
      })
    );
  }

  hideComment$(
    ownerUid: string,
    photoId: string,
    commentId: string
  ): Observable<TPhotoCommentStatus | null> {
    return this.moderateComment$(ownerUid, photoId, commentId, 'HIDE');
  }

  restoreComment$(
    ownerUid: string,
    photoId: string,
    commentId: string
  ): Observable<TPhotoCommentStatus | null> {
    return this.moderateComment$(ownerUid, photoId, commentId, 'RESTORE');
  }

  deleteComment$(
    ownerUid: string,
    photoId: string,
    commentId: string
  ): Observable<TPhotoCommentStatus | null> {
    return this.moderateComment$(ownerUid, photoId, commentId, 'DELETE');
  }

  /**
   * Mantido para compatibilidade com chamadas antigas.
   *
   * Agora usa Callable em vez de updateDoc direto.
   */
  softDeleteComment$(
    ownerUid: string,
    photoId: string,
    commentId: string,
    _requesterUid: string
  ): Observable<void> {
    return this.deleteComment$(ownerUid, photoId, commentId).pipe(
      map(() => void 0)
    );
  }

  private callCreateComment$(
    payload: CreatePhotoCommentCallableRequest
  ): Observable<string | null> {
    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        CreatePhotoCommentCallableRequest,
        CreatePhotoCommentCallableResponse
      >(this.functions, 'createPhotoComment');

      const response = await callable(payload);

      this.debug('comment callable success', {
        hasOwnerUid: !!payload.ownerUid,
        hasPhotoId: !!payload.photoId,
        isReply: !!payload.parentCommentId,
      });

      return response.data?.commentId ?? null;
    });
  }

  private moderateComment$(
    ownerUid: string,
    photoId: string,
    commentId: string,
    action: TModeratePhotoCommentAction
  ): Observable<TPhotoCommentStatus | null> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safePhotoId = this.cleanId(photoId);
    const safeCommentId = this.cleanId(commentId);

    if (!safeOwnerUid || !safePhotoId || !safeCommentId) {
      this.errorNotifier.showWarning('Comentário inválido.');
      return of(null);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        ModeratePhotoCommentCallableRequest,
        ModeratePhotoCommentCallableResponse
      >(this.functions, 'moderatePhotoComment');

      const response = await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
        commentId: safeCommentId,
        action,
      });

      this.debug('comment moderation callable success', {
        action,
        hasOwnerUid: !!safeOwnerUid,
        hasPhotoId: !!safePhotoId,
        hasCommentId: !!safeCommentId,
      });

      return response.data?.status ?? null;
    }).pipe(
      catchError((error) => {
        this.reportError(
          this.resolveModerationErrorMessage(action),
          error,
          {
            op: 'moderateComment$',
            action,
            hasOwnerUid: !!safeOwnerUid,
            hasPhotoId: !!safePhotoId,
            hasCommentId: !!safeCommentId,
          },
          false
        );

        return of(null);
      })
    );
  }

private commentsPath(ownerUid: string, photoId: string): string {
  return `public_profiles/${ownerUid}/public_photos/${photoId}/comments`;
}

  private cleanId(value: string | null | undefined): string {
    return String(value ?? '').trim();
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

      parentCommentId: item.parentCommentId ?? null,
      isOwnerReply: item.isOwnerReply ?? false,
      replyToAuthorUid: item.replyToAuthorUid ?? null,
      replyToAuthorNickname: item.replyToAuthorNickname ?? null,

      likesCount: item.likesCount ?? 0,
      reportsCount: item.reportsCount ?? 0,

      createdAt: item.createdAt ?? 0,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt ?? null,
    };
  }

  private resolveModerationErrorMessage(action: TModeratePhotoCommentAction): string {
    if (action === 'HIDE') {
      return 'Erro ao ocultar comentário.';
    }

    if (action === 'RESTORE') {
      return 'Erro ao restaurar comentário.';
    }

    return 'Erro ao remover comentário.';
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
