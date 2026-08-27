// src/app/community/data-access/community-topic.repository.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC REPOSITORY
// -----------------------------------------------------------------------------
// Callables são envolvidas em Observable e só executam após assinatura.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityTopicCreateRequest,
  CommunityTopicCreateResponse,
  CommunityTopicDetailRequest,
  CommunityTopicDetailResponse,
  CommunityTopicModerationRequest,
  CommunityTopicModerationResponse,
  CommunityTopicPage,
  CommunityTopicPageRequest,
  CommunityTopicRepliesPage,
  CommunityTopicRepliesPageRequest,
  CommunityTopicReplyCreateRequest,
  CommunityTopicReplyCreateResponse,
  normalizeCommunityTopicCreateResponse,
  normalizeCommunityTopicDetailResponse,
  normalizeCommunityTopicModerationResponse,
  normalizeCommunityTopicPageResponse,
  normalizeCommunityTopicRepliesPageResponse,
  normalizeCommunityTopicReplyCreateResponse,
} from './community-topic.model';

@Injectable({ providedIn: 'root' })
export class CommunityTopicRepository {
  private readonly functions = inject(Functions);

  private readonly getTopicsPageCallable = httpsCallable<CommunityTopicPageRequest, unknown>(
    this.functions,
    'getCommunityTopicsPage'
  );

  private readonly getTopicDetailCallable = httpsCallable<CommunityTopicDetailRequest, unknown>(
    this.functions,
    'getCommunityTopicDetail'
  );

  private readonly getTopicRepliesPageCallable = httpsCallable<
    CommunityTopicRepliesPageRequest,
    unknown
  >(this.functions, 'getCommunityTopicRepliesPage');

  private readonly createTopicCallable = httpsCallable<CommunityTopicCreateRequest, unknown>(
    this.functions,
    'createCommunityTopic'
  );

  private readonly createReplyCallable = httpsCallable<
    CommunityTopicReplyCreateRequest,
    unknown
  >(this.functions, 'createCommunityTopicReply');

  private readonly moderateTopicCallable = httpsCallable<
    CommunityTopicModerationRequest,
    unknown
  >(this.functions, 'moderateCommunityTopic');

  getPage$(request: CommunityTopicPageRequest): Observable<CommunityTopicPage> {
    const payload: CommunityTopicPageRequest = {
      communityId: request.communityId.trim(),
      limit: request.limit ?? 12,
      cursor: request.cursor ?? null,
    };

    return defer(() => from(this.getTopicsPageCallable(payload))).pipe(
      map((result) => normalizeCommunityTopicPageResponse(result.data))
    );
  }

  getDetail$(request: CommunityTopicDetailRequest): Observable<CommunityTopicDetailResponse> {
    const payload: CommunityTopicDetailRequest = {
      communityId: request.communityId.trim(),
      topicId: request.topicId.trim(),
    };

    return defer(() => from(this.getTopicDetailCallable(payload))).pipe(
      map((result) => normalizeCommunityTopicDetailResponse(result.data))
    );
  }

  getRepliesPage$(
    request: CommunityTopicRepliesPageRequest
  ): Observable<CommunityTopicRepliesPage> {
    const payload: CommunityTopicRepliesPageRequest = {
      communityId: request.communityId.trim(),
      topicId: request.topicId.trim(),
      limit: request.limit ?? 20,
      cursor: request.cursor ?? null,
    };

    return defer(() => from(this.getTopicRepliesPageCallable(payload))).pipe(
      map((result) => normalizeCommunityTopicRepliesPageResponse(result.data))
    );
  }

  createTopic$(request: CommunityTopicCreateRequest): Observable<CommunityTopicCreateResponse> {
    const payload: CommunityTopicCreateRequest = {
      requestId: request.requestId.trim(),
      communityId: request.communityId.trim(),
      title: request.title.trim(),
      body: request.body.trim(),
      audience: request.audience ?? 'public_preview',
    };

    return defer(() => from(this.createTopicCallable(payload))).pipe(
      map((result) => normalizeCommunityTopicCreateResponse(result.data))
    );
  }

  createReply$(
    request: CommunityTopicReplyCreateRequest
  ): Observable<CommunityTopicReplyCreateResponse> {
    const payload: CommunityTopicReplyCreateRequest = {
      requestId: request.requestId.trim(),
      communityId: request.communityId.trim(),
      topicId: request.topicId.trim(),
      body: request.body.trim(),
    };

    return defer(() => from(this.createReplyCallable(payload))).pipe(
      map((result) => normalizeCommunityTopicReplyCreateResponse(result.data))
    );
  }

  moderateTopic$(
    request: CommunityTopicModerationRequest
  ): Observable<CommunityTopicModerationResponse> {
    const payload: CommunityTopicModerationRequest = {
      requestId: request.requestId.trim(),
      communityId: request.communityId.trim(),
      topicId: request.topicId.trim(),
      action: request.action,
      reason: request.reason?.trim() || null,
    };

    return defer(() => from(this.moderateTopicCallable(payload))).pipe(
      map((result) => normalizeCommunityTopicModerationResponse(result.data))
    );
  }
}
