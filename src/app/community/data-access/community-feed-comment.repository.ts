// -----------------------------------------------------------------------------
// COMMUNITY FEED COMMENT REPOSITORY
// -----------------------------------------------------------------------------
// A conversa principal é plana e autorizada por callables. Compatibilidade com
// clientes antigos permanece nas Functions; o Angular atual usa apenas a
// timeline plana com replyToCommentId.
// -----------------------------------------------------------------------------

import {
  Injectable,
  inject,
} from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  defer,
  from,
  map,
} from 'rxjs';

import {
  CommunityFeedCommentActionRequest,
  CommunityFeedCommentActionResponse,
  CommunityFeedCommentCreateRequest,
  CommunityFeedCommentCreateResponse,
  CommunityFeedCommentPage,
  CommunityFeedCommentPageRequest,
  normalizeCommunityFeedCommentActionResponse,
  normalizeCommunityFeedCommentCreateResponse,
  normalizeCommunityFeedCommentPageResponse,
} from './community-feed-comment.model';
import { CommunityFeedRepository } from './community-feed.repository';

@Injectable({ providedIn: 'root' })
export class CommunityFeedCommentRepository {
  private readonly functions = inject(Functions);
  private readonly feedRepository = inject(CommunityFeedRepository);
  private readonly getPageCallable = httpsCallable<
    CommunityFeedCommentPageRequest,
    unknown
  >(this.functions, 'getCommunityFeedCommentsPage');
  private readonly createCallable = httpsCallable<
    CommunityFeedCommentCreateRequest,
    unknown
  >(this.functions, 'createCommunityFeedComment');

  private readonly moderateCallable = httpsCallable<
    CommunityFeedCommentActionRequest,
    unknown
  >(this.functions, 'moderateCommunityFeedComment');

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

  /**
   * A projeção Firestore pertence ao CommunityFeedRepository. Este repositório
   * conserva apenas a API da conversa para não criar um segundo owner realtime.
   */
  watchCommentCount$(
    communityId: string,
    postId: string
  ): Observable<number> {
    return this.feedRepository.watchPostCommentCount$(communityId, postId);
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

}
