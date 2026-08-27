// -----------------------------------------------------------------------------
// COMMUNITY FEED COMMENT REPOSITORY
// -----------------------------------------------------------------------------
// A conversa principal é plana e autorizada por callables. Callables legadas
// de replies permanecem disponíveis apenas para compatibilidade/moderação de
// documentos antigos enquanto a migração é concluída.
// -----------------------------------------------------------------------------

import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import {
  DocumentData,
  DocumentReference,
} from 'firebase/firestore';
import {
  Firestore,
  doc,
  docSnapshots,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  defer,
  distinctUntilChanged,
  from,
  map,
  of,
} from 'rxjs';

import {
  CommunityFeedCommentActionRequest,
  CommunityFeedCommentActionResponse,
  CommunityFeedCommentCreateRequest,
  CommunityFeedCommentCreateResponse,
  CommunityFeedCommentPage,
  CommunityFeedCommentPageRequest,
  CommunityFeedCommentReplyActionRequest,
  CommunityFeedCommentReplyActionResponse,
  CommunityFeedCommentReplyCreateRequest,
  CommunityFeedCommentReplyCreateResponse,
  CommunityFeedCommentReplyPage,
  CommunityFeedCommentReplyPageRequest,
  normalizeCommunityFeedCommentActionResponse,
  normalizeCommunityFeedCommentCreateResponse,
  normalizeCommunityFeedCommentPageResponse,
  normalizeCommunityFeedCommentReplyActionResponse,
  normalizeCommunityFeedCommentReplyCreateResponse,
  normalizeCommunityFeedCommentReplyPageResponse,
} from './community-feed-comment.model';
import { normalizeCommunityFeedRealtimeProjection } from './community-feed-realtime.model';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

@Injectable({ providedIn: 'root' })
export class CommunityFeedCommentRepository {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly getPageCallable = httpsCallable<
    CommunityFeedCommentPageRequest,
    unknown
  >(this.functions, 'getCommunityFeedCommentsPage');
  private readonly createCallable = httpsCallable<
    CommunityFeedCommentCreateRequest,
    unknown
  >(this.functions, 'createCommunityFeedComment');

  // Compatibilidade legada: novas respostas não usam mais estas callables.
  private readonly getRepliesPageCallable = httpsCallable<
    CommunityFeedCommentReplyPageRequest,
    unknown
  >(this.functions, 'getCommunityFeedCommentRepliesPage');
  private readonly createReplyCallable = httpsCallable<
    CommunityFeedCommentReplyCreateRequest,
    unknown
  >(this.functions, 'createCommunityFeedCommentReply');
  private readonly moderateCallable = httpsCallable<
    CommunityFeedCommentActionRequest,
    unknown
  >(this.functions, 'moderateCommunityFeedComment');
  private readonly moderateReplyCallable = httpsCallable<
    CommunityFeedCommentReplyActionRequest,
    unknown
  >(this.functions, 'moderateCommunityFeedCommentReply');

  getPage$(
    request: CommunityFeedCommentPageRequest
  ): Observable<CommunityFeedCommentPage> {
    const payload: CommunityFeedCommentPageRequest = {
      communityId: request.communityId.trim(),
      postId: request.postId.trim(),
      limit: request.limit ?? 12,
      cursor: request.cursor?.trim() || null,
    };
    return defer(() => from(this.getPageCallable(payload))).pipe(
      map((response) => normalizeCommunityFeedCommentPageResponse(response.data))
    );
  }

  /** @deprecated Novas respostas pertencem à timeline plana de comentários. */
  getRepliesPage$(
    request: CommunityFeedCommentReplyPageRequest
  ): Observable<CommunityFeedCommentReplyPage> {
    const payload: CommunityFeedCommentReplyPageRequest = {
      communityId: request.communityId.trim(),
      postId: request.postId.trim(),
      commentId: request.commentId.trim(),
      limit: request.limit ?? 8,
      cursor: request.cursor?.trim() || null,
    };
    return defer(() => from(this.getRepliesPageCallable(payload))).pipe(
      map((response) => normalizeCommunityFeedCommentReplyPageResponse(response.data))
    );
  }

  /**
   * Observa somente `metrics.commentCount` do stream realtime sanitizado do post.
   * O conteúdo da conversa permanece backend-only e é revalidado pela callable.
   */
  watchCommentCount$(
    communityId: string,
    postId: string
  ): Observable<number> {
    return defer(() => {
      const safeCommunityId = communityId.trim();
      const safePostId = postId.trim();
      if (
        !SAFE_ID_PATTERN.test(safeCommunityId)
        || !SAFE_ID_PATTERN.test(safePostId)
      ) {
        return of(0);
      }

      const source$ = runInInjectionContext(this.environmentInjector, () => {
        const reference = doc(
          this.firestore,
          `community_feed_realtime/${safeCommunityId}/items/${safePostId}`
        ) as DocumentReference<DocumentData>;
        return docSnapshots(reference);
      });

      return source$.pipe(
        map((snapshot) => {
          if (!snapshot.exists()) return 0;
          const projection = normalizeCommunityFeedRealtimeProjection(
            snapshot.id,
            snapshot.data()
          );
          return projection?.state === 'active'
            ? projection.metrics.commentCount
            : 0;
        }),
        distinctUntilChanged()
      );
    });
  }

  createComment$(
    request: CommunityFeedCommentCreateRequest
  ): Observable<CommunityFeedCommentCreateResponse> {
    const payload: CommunityFeedCommentCreateRequest = {
      requestId: request.requestId.trim(),
      communityId: request.communityId.trim(),
      postId: request.postId.trim(),
      text: request.text.trim(),
      replyToCommentId: request.replyToCommentId?.trim() || null,
    };
    return defer(() => from(this.createCallable(payload))).pipe(
      map((response) => normalizeCommunityFeedCommentCreateResponse(response.data))
    );
  }

  /** @deprecated Novas respostas usam createComment$ com replyToCommentId. */
  createReply$(
    request: CommunityFeedCommentReplyCreateRequest
  ): Observable<CommunityFeedCommentReplyCreateResponse> {
    const payload: CommunityFeedCommentReplyCreateRequest = {
      requestId: request.requestId.trim(),
      communityId: request.communityId.trim(),
      postId: request.postId.trim(),
      commentId: request.commentId.trim(),
      text: request.text.trim(),
    };
    return defer(() => from(this.createReplyCallable(payload))).pipe(
      map((response) => normalizeCommunityFeedCommentReplyCreateResponse(response.data))
    );
  }

  moderateComment$(
    request: CommunityFeedCommentActionRequest
  ): Observable<CommunityFeedCommentActionResponse> {
    const payload: CommunityFeedCommentActionRequest = {
      requestId: request.requestId.trim(),
      communityId: request.communityId.trim(),
      postId: request.postId.trim(),
      commentId: request.commentId.trim(),
      action: request.action,
      reason: request.reason?.trim() || null,
    };
    return defer(() => from(this.moderateCallable(payload))).pipe(
      map((response) => normalizeCommunityFeedCommentActionResponse(response.data))
    );
  }

  /** @deprecated Mantido somente para moderação de respostas legadas. */
  moderateReply$(
    request: CommunityFeedCommentReplyActionRequest
  ): Observable<CommunityFeedCommentReplyActionResponse> {
    const payload: CommunityFeedCommentReplyActionRequest = {
      requestId: request.requestId.trim(),
      communityId: request.communityId.trim(),
      postId: request.postId.trim(),
      commentId: request.commentId.trim(),
      replyId: request.replyId.trim(),
      action: request.action,
      reason: request.reason?.trim() || null,
    };
    return defer(() => from(this.moderateReplyCallable(payload))).pipe(
      map((response) => normalizeCommunityFeedCommentReplyActionResponse(response.data))
    );
  }
}
