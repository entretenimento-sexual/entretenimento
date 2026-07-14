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
import { catchError, map, shareReplay } from 'rxjs/operators';

import {
  IVideoComment,
  TVideoCommentStatus,
} from 'src/app/core/interfaces/media/i-video-comment';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

export interface CreateVideoCommentCommand {
  ownerUid: string;
  videoId: string;
  content: string;
}

export interface ReplyToVideoCommentCommand {
  ownerUid: string;
  videoId: string;
  parentCommentId: string;
  content: string;
}

export type ModerateVideoCommentAction = 'HIDE' | 'RESTORE' | 'DELETE';

interface CreateVideoCommentRequest {
  ownerUid: string;
  videoId: string;
  content: string;
  parentCommentId?: string | null;
}

interface CreateVideoCommentResponse {
  commentId: string;
}

interface ModerateVideoCommentRequest {
  ownerUid: string;
  videoId: string;
  commentId: string;
  action: ModerateVideoCommentAction;
}

interface ModerateVideoCommentResponse {
  status: TVideoCommentStatus;
  commentsCount: number;
  score: number;
}

@Injectable({ providedIn: 'root' })
export class MediaVideoCommentsService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly createCommentCallable = httpsCallable<
    CreateVideoCommentRequest,
    CreateVideoCommentResponse
  >(this.functions, 'createVideoComment');
  private readonly moderateCommentCallable = httpsCallable<
    ModerateVideoCommentRequest,
    ModerateVideoCommentResponse
  >(this.functions, 'moderateVideoComment');

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  watchVisibleComments$(
    ownerUid: string,
    videoId: string,
    takeCount = 40
  ): Observable<IVideoComment[]> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safeVideoId = this.cleanId(videoId);
    const safeTakeCount = Math.max(1, Math.min(100, Math.floor(takeCount)));

    if (!safeOwnerUid || !safeVideoId) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const commentsRef = collection(
        this.firestore,
        this.commentsPath(safeOwnerUid, safeVideoId)
      );
      const commentsQuery = query(
        commentsRef,
        where('status', '==', 'VISIBLE'),
        orderBy('createdAt', 'asc'),
        limit(safeTakeCount)
      );

      return collectionData(commentsQuery, { idField: 'id' }) as Observable<
        IVideoComment[]
      >;
    }).pipe(
      map((items) =>
        items.map((item) =>
          this.normalizeComment(item, safeOwnerUid, safeVideoId)
        )
      ),
      catchError((error) => {
        this.reportError(
          'Erro ao carregar comentários do vídeo.',
          error,
          {
            op: 'watchVisibleComments$',
            hasOwnerUid: !!safeOwnerUid,
            hasVideoId: !!safeVideoId,
          },
          true
        );
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  createComment$(command: CreateVideoCommentCommand): Observable<string | null> {
    return this.createOrReplyComment$({
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      content: command.content,
      parentCommentId: null,
    });
  }

  replyToComment$(
    command: ReplyToVideoCommentCommand
  ): Observable<string | null> {
    return this.createOrReplyComment$({
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      content: command.content,
      parentCommentId: command.parentCommentId,
    });
  }

  hideComment$(
    ownerUid: string,
    videoId: string,
    commentId: string
  ): Observable<TVideoCommentStatus | null> {
    return this.moderateComment$(ownerUid, videoId, commentId, 'HIDE');
  }

  restoreComment$(
    ownerUid: string,
    videoId: string,
    commentId: string
  ): Observable<TVideoCommentStatus | null> {
    return this.moderateComment$(ownerUid, videoId, commentId, 'RESTORE');
  }

  deleteComment$(
    ownerUid: string,
    videoId: string,
    commentId: string
  ): Observable<TVideoCommentStatus | null> {
    return this.moderateComment$(ownerUid, videoId, commentId, 'DELETE');
  }

  private createOrReplyComment$(
    command: CreateVideoCommentRequest
  ): Observable<string | null> {
    const ownerUid = this.cleanId(command.ownerUid);
    const videoId = this.cleanId(command.videoId);
    const parentCommentId = this.cleanId(command.parentCommentId) || null;
    const content = this.cleanContent(command.content);

    if (!ownerUid || !videoId || !content) {
      this.errorNotifier.showWarning('Comentário inválido.');
      return of(null);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.createCommentCallable({
        ownerUid,
        videoId,
        content,
        parentCommentId,
      });
      return response.data.commentId ?? null;
    }).pipe(
      catchError((error) => {
        this.reportError(
          parentCommentId
            ? 'Erro ao responder comentário.'
            : 'Erro ao publicar comentário.',
          error,
          {
            op: 'createOrReplyComment$',
            isReply: !!parentCommentId,
            hasOwnerUid: !!ownerUid,
            hasVideoId: !!videoId,
          }
        );
        return of(null);
      })
    );
  }

  private moderateComment$(
    ownerUidValue: string,
    videoIdValue: string,
    commentIdValue: string,
    action: ModerateVideoCommentAction
  ): Observable<TVideoCommentStatus | null> {
    const ownerUid = this.cleanId(ownerUidValue);
    const videoId = this.cleanId(videoIdValue);
    const commentId = this.cleanId(commentIdValue);

    if (!ownerUid || !videoId || !commentId) {
      this.errorNotifier.showWarning('Comentário inválido.');
      return of(null);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.moderateCommentCallable({
        ownerUid,
        videoId,
        commentId,
        action,
      });
      return response.data.status ?? null;
    }).pipe(
      catchError((error) => {
        this.reportError(
          action === 'HIDE'
            ? 'Erro ao ocultar comentário.'
            : action === 'RESTORE'
              ? 'Erro ao restaurar comentário.'
              : 'Erro ao remover comentário.',
          error,
          {
            op: 'moderateComment$',
            action,
            hasOwnerUid: !!ownerUid,
            hasVideoId: !!videoId,
            hasCommentId: !!commentId,
          }
        );
        return of(null);
      })
    );
  }

  private commentsPath(ownerUid: string, videoId: string): string {
    return `public_profiles/${ownerUid}/public_videos/${videoId}/comments`;
  }

  private cleanId(value: string | null | undefined): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private cleanContent(value: string | null | undefined): string {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  private normalizeComment(
    item: IVideoComment,
    ownerUid: string,
    videoId: string
  ): IVideoComment {
    return {
      id: item.id,
      ownerUid: item.ownerUid || ownerUid,
      videoId: item.videoId || videoId,
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

  private reportError(
    userMessage: string,
    error: unknown,
    context: Record<string, unknown>,
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
        scope: 'MediaVideoCommentsService',
        ...context,
      };
      (normalized as any).skipUserNotification = silent;
      this.errorHandler.handleError(normalized);
      this.privacyDebug.log('media', 'MediaVideoCommentsService: falha', context);
    } catch {
      // noop
    }
  }
}
