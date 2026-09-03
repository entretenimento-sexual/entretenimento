// -----------------------------------------------------------------------------
// CREATE COMMUNITY FEED COMMENT REPLY
// -----------------------------------------------------------------------------
// Respostas possuem somente um nível. Isso preserva leitura mobile simples,
// paginação previsível e evita árvores arbitrárias difíceis de moderar.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import {
  buildBilateralBlockPaths,
  isBilateralBlockActive,
} from '../friendship/application/bilateral-block-access.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  CommunityFeedCommentReplyCreateRequest,
  CommunityFeedCommentReplyCreateResponse,
  normalizeCommunityFeedCommentReplyCreateRequest,
  sanitizeCommunityFeedComment,
} from './community-feed-comment.model';
import { evaluateCommunityFeedCommentWrite } from './community-feed-comment.policy';
import { sanitizeCommunityFeedProjection } from './community-feed.model';
import { buildCommunityPublicAuthor } from './community-public-author.model';
import { isCommunityMemberActivityEnabledStatus } from './community-lifecycle.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  allowsCommunityActivityNotifications,
  buildCommunityNotificationRoute,
  buildCommunityReplyNotificationCopy,
  buildCommunityReplyNotificationId,
  canReceiveCommunityActivityNotification,
  type CommunityNotificationPreferences,
  type CommunityNotificationUser,
} from './community-notification.policy';
import type { CommunityViewerRole } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'As respostas dos comentários ainda não estão disponíveis neste ambiente.',
    { reason: 'community_feed_conversation_unavailable' }
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Usuário não autenticado.',
      { reason: 'authentication_required' }
    );
  }
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.',
      { reason: 'email_verification_required' }
    );
  }
  return uid;
}

function normalizeRole(value: unknown): CommunityViewerRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), 1_000_000_000)
    : 0;
}

function throwDenied(reason: string | null): never {
  if (reason === 'active_membership_required') {
    throw new HttpsError(
      'permission-denied',
      'Participe da Comunidade para responder.',
      { reason }
    );
  }
  if (reason === 'post_unavailable') {
    throw new HttpsError(
      'failed-precondition',
      'A publicação não aceita respostas.',
      { reason }
    );
  }
  throw new HttpsError(
    'failed-precondition',
    'A conversa não aceita respostas agora.',
    { reason: reason ?? 'community_unavailable' }
  );
}

function existingResponse(
  raw: FirebaseFirestore.DocumentData,
  actorUid: string,
  communityId: string,
  postId: string,
  commentId: string,
  replyId: string
): CommunityFeedCommentReplyCreateResponse | null {
  if (
    raw['kind'] !== 'comment_reply_create'
    || raw['actorUid'] !== actorUid
    || raw['communityId'] !== communityId
    || raw['postId'] !== postId
    || raw['commentId'] !== commentId
    || raw['replyId'] !== replyId
  ) {
    return null;
  }

  return {
    communityId,
    postId,
    commentId,
    replyId,
    replyCount: normalizeCount(raw['replyCount']),
    created: false,
    deduplicated: true,
  };
}

export const createCommunityFeedCommentReply = onCall<
  CommunityFeedCommentReplyCreateRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedCommentReplyCreateResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedCommentReplyCreateRequest(request.data);
    if (
      !command.requestId
      || !command.communityId
      || !command.postId
      || !command.commentId
      || !command.text
      || command.textTooLong
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Resposta inválida.',
        { reason: 'invalid_conversation_reply' }
      );
    }

    const communityId = command.communityId;
    const postId = command.postId;
    const commentId = command.commentId;
    const replyId = command.requestId;
    const requestRef = db.collection('community_feed_requests').doc(replyId);
    const preexisting = await requestRef.get();

    if (preexisting.exists) {
      const response = existingResponse(
        preexisting.data() ?? {},
        actorUid,
        communityId,
        postId,
        commentId,
        replyId
      );
      if (!response) {
        throw new HttpsError(
          'already-exists',
          'Este identificador já foi utilizado.',
          { reason: 'request_id_conflict' }
        );
      }
      return response;
    }

    const context = await getCommunityViewerContext(actorUid, communityId);
    if (!context.canInteract) {
      throw new HttpsError(
        'permission-denied',
        'Participe da Comunidade para responder.',
        { reason: 'active_membership_required' }
      );
    }

    await consumeCommunityRateLimit({
      action: 'feed_conversation',
      actorUid,
    });

    return db.runTransaction(async (transaction): Promise<CommunityFeedCommentReplyCreateResponse> => {
      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const publicProfileRef = db.collection('public_profiles').doc(actorUid);
      const postRef = db
        .collection('community_feed_posts')
        .doc(communityId)
        .collection('items')
        .doc(postId);
      const projectionRef = db
        .collection('community_public_feed')
        .doc(communityId)
        .collection('items')
        .doc(postId);
      const commentRef = postRef.collection('comments').doc(commentId);
      const replyRef = commentRef.collection('replies').doc(replyId);
      const userReplyRef = db
        .collection('community_feed_user_replies')
        .doc(actorUid)
        .collection('items')
        .doc(`${communityId}:${postId}:${commentId}:${replyId}`);
      const auditRef = db
        .collection('community_feed_audit')
        .doc(`comment-reply-${replyId}`);

      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        publicProfileSnapshot,
        postSnapshot,
        projectionSnapshot,
        commentSnapshot,
        replySnapshot,
        requestSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(publicProfileRef),
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(commentRef),
        transaction.get(replyRef),
        transaction.get(requestRef),
      ]);

      if (requestSnapshot.exists) {
        const response = existingResponse(
          requestSnapshot.data() ?? {},
          actorUid,
          communityId,
          postId,
          commentId,
          replyId
        );
        if (!response) {
          throw new HttpsError(
            'already-exists',
            'Este identificador já foi utilizado.',
            { reason: 'request_id_conflict' }
          );
        }
        return response;
      }
      if (!communitySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comunidade não encontrada.',
          { reason: 'community_not_found' }
        );
      }
      if (!postSnapshot.exists || !projectionSnapshot.exists || !commentSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comentário não encontrado.',
          { reason: 'community_feed_comment_not_found' }
        );
      }
      if (replySnapshot.exists) {
        throw new HttpsError(
          'already-exists',
          'Esta resposta já existe.',
          { reason: 'conversation_reply_already_exists' }
        );
      }

      assertCommunityMembershipActorEligible(
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      const community = communitySnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
      const membership = membershipSnapshot.exists
        ? membershipSnapshot.data() ?? {}
        : {};
      const post = postSnapshot.data() ?? {};
      const projection = sanitizeCommunityFeedProjection(
        postId,
        projectionSnapshot.data()
      );
      const parentComment = sanitizeCommunityFeedComment(
        commentId,
        commentSnapshot.data()
      );

      if (!projection || !parentComment) {
        throw new HttpsError(
          'failed-precondition',
          'O comentário não aceita respostas.',
          { reason: 'referenced_message_unavailable' }
        );
      }

      const decision = evaluateCommunityFeedCommentWrite({
        sourceType: source['type'],
        memberActivityAllowed:
          moderation['state'] === 'active'
          && isCommunityMemberActivityEnabledStatus(community['status']),
        membershipStatus: membership['status'],
        viewerRole: normalizeRole(membership['role']),
        postKind: post['kind'],
        postStatus: post['status'],
        postModerationState: post['moderationState'],
      });
      if (!decision.allowed) throwDenied(decision.denialReason);

      const nowMs = Date.now();
      const parentAuthorUid = parentComment.actorUid;
      const notificationRef = parentAuthorUid !== actorUid
        ? db.collection('notifications').doc(
          buildCommunityReplyNotificationId(
            communityId,
            postId,
            commentId,
            parentAuthorUid,
            nowMs
          )
        )
        : null;
      let shouldNotify = false;
      let existingNotification: FirebaseFirestore.DocumentData | undefined;

      if (notificationRef) {
        const recipientUserRef = db.collection('users').doc(parentAuthorUid);
        const recipientPreferencesRef = db
          .collection('preferences')
          .doc(parentAuthorUid);
        const [actorBlockPath, recipientBlockPath] = buildBilateralBlockPaths(
          actorUid,
          parentAuthorUid
        );
        const [
          recipientUserSnapshot,
          recipientPreferencesSnapshot,
          notificationSnapshot,
          actorBlockSnapshot,
          recipientBlockSnapshot,
        ] = await Promise.all([
          transaction.get(recipientUserRef),
          transaction.get(recipientPreferencesRef),
          transaction.get(notificationRef),
          transaction.get(db.doc(actorBlockPath)),
          transaction.get(db.doc(recipientBlockPath)),
        ]);
        const recipientUser = recipientUserSnapshot.data() as
          | CommunityNotificationUser
          | undefined;
        const recipientPreferences = recipientPreferencesSnapshot.data() as
          | CommunityNotificationPreferences
          | undefined;

        shouldNotify = canReceiveCommunityActivityNotification(
          recipientUser,
          parentAuthorUid,
          actorUid
        )
          && allowsCommunityActivityNotifications(recipientPreferences)
          && !isBilateralBlockActive({
            actorBlock: actorBlockSnapshot.data(),
            targetBlock: recipientBlockSnapshot.data(),
          });
        existingNotification = notificationSnapshot.data();
      }

      const comment = commentSnapshot.data() ?? {};
      const commentMetrics = (comment['metrics'] ?? {}) as Record<string, unknown>;
      const replyCount = Math.min(
        normalizeCount(commentMetrics['replyCount']) + 1,
        1_000_000_000
      );
      const now = Timestamp.fromMillis(nowMs);
      const author = buildCommunityPublicAuthor(
        publicProfileSnapshot.exists ? publicProfileSnapshot.data() : null,
        { label: 'Participante', avatarUrl: null }
      );

      transaction.create(replyRef, {
        replyId,
        communityId,
        postId,
        commentId,
        actorUid,
        author,
        text: command.text,
        status: 'active',
        moderationState: 'active',
        createdAt: now,
        updatedAt: now,
      });
      transaction.create(userReplyRef, {
        actorUid,
        communityId,
        postId,
        commentId,
        replyId,
        createdAt: nowMs,
      });
      transaction.create(requestRef, {
        requestId: replyId,
        kind: 'comment_reply_create',
        actorUid,
        communityId,
        postId,
        commentId,
        replyId,
        replyCount,
        completedAt: nowMs,
        createdAt: nowMs,
      });
      transaction.create(auditRef, {
        action: 'community-feed-comment-reply-created',
        actorUid,
        communityId,
        postId,
        commentId,
        replyId,
        createdAt: nowMs,
      });
      transaction.update(commentRef, {
        'metrics.replyCount': replyCount,
        updatedAt: now,
      });

      if (shouldNotify && notificationRef) {
        const copy = buildCommunityReplyNotificationCopy({
          existingActivityCount: existingNotification?.['activityCount'],
          actorLabel: author.label,
          communityName: community['name'],
        });
        transaction.set(notificationRef, {
          userId: parentAuthorUid,
          type: 'community.comment.reply.received',
          title: copy.title,
          body: copy.body,
          route: buildCommunityNotificationRoute(communityId),
          communityId,
          postId,
          commentId,
          replyId,
          activityCount: copy.activityCount,
          actorUid,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
      }

      return {
        communityId,
        postId,
        commentId,
        replyId,
        replyCount,
        created: true,
        deduplicated: false,
      };
    });
  }
);
