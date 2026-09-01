// -----------------------------------------------------------------------------
// MODERATE COMMUNITY FEED COMMENT REPLY
// -----------------------------------------------------------------------------
// Respostas compartilham a política de autoria/gestão dos comentários, mas o
// contador autoritativo pertence ao comentário pai, não à publicação.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  CommunityFeedCommentReplyActionRequest,
  CommunityFeedCommentReplyActionResponse,
  CommunityFeedCommentStatus,
  normalizeCommunityFeedCommentReplyActionRequest,
} from './community-feed-comment.model';
import { evaluateCommunityFeedCommentAction } from './community-feed-comment.policy';
import { isCommunityMemberActivityEnabledStatus } from './community-lifecycle.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  buildCommunityModerationNotificationCopy,
  buildCommunityModerationNotificationId,
  buildCommunityNotificationRoute,
  canReceiveCommunityEssentialNotification,
  type CommunityNotificationUser,
} from './community-notification.policy';
import type { CommunityViewerRole } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'As ações de resposta ainda não estão disponíveis neste ambiente.',
    { reason: 'community_feed_comment_actions_unavailable' }
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

function normalizeStatus(value: unknown): CommunityFeedCommentStatus | null {
  return value === 'active' || value === 'deleted' || value === 'removed'
    ? value
    : null;
}

function normalizeModerationState(value: unknown): 'active' | 'removed' | null {
  return value === 'active' || value === 'removed' ? value : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), 1_000_000_000)
    : 0;
}

function throwDenied(reason: string | null): never {
  if (reason === 'comment_author_required') {
    throw new HttpsError(
      'permission-denied',
      'Somente o autor pode excluir a resposta.',
      { reason }
    );
  }
  if (reason === 'active_management_required') {
    throw new HttpsError(
      'permission-denied',
      'A gestão ativa da Comunidade é necessária.',
      { reason }
    );
  }
  if (reason === 'removal_reason_required') {
    throw new HttpsError(
      'invalid-argument',
      'Informe um motivo com pelo menos 3 caracteres.',
      { reason }
    );
  }
  throw new HttpsError(
    'failed-precondition',
    'Esta resposta não permite a ação.',
    { reason: reason ?? 'comment_unavailable' }
  );
}

export const moderateCommunityFeedCommentReply = onCall<
  CommunityFeedCommentReplyActionRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedCommentReplyActionResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedCommentReplyActionRequest(request.data);
    if (
      !command.requestId
      || !command.communityId
      || !command.postId
      || !command.commentId
      || !command.replyId
      || !command.action
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Ação de resposta inválida.',
        { reason: 'invalid_comment_action' }
      );
    }
    if (command.reasonTooLong) {
      throw new HttpsError(
        'invalid-argument',
        'O motivo deve ter no máximo 240 caracteres.',
        { reason: 'removal_reason_too_long' }
      );
    }

    const communityId = command.communityId;
    const postId = command.postId;
    const commentId = command.commentId;
    const replyId = command.replyId;
    const action = command.action;
    const requestId = command.requestId;

    if (action === 'remove') {
      await consumeCommunityRateLimit({
        action: 'content_moderation',
        actorUid,
      });
    }

    return db.runTransaction(async (transaction): Promise<CommunityFeedCommentReplyActionResponse> => {
      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const postRef = db
        .collection('community_feed_posts')
        .doc(communityId)
        .collection('items')
        .doc(postId);
      const commentRef = postRef.collection('comments').doc(commentId);
      const replyRef = commentRef.collection('replies').doc(replyId);
      const requestRef = db.collection('community_feed_requests').doc(requestId);
      const auditRef = db
        .collection('community_feed_audit')
        .doc(`comment-reply-action-${requestId}`);

      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        postSnapshot,
        commentSnapshot,
        replySnapshot,
        requestSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(postRef),
        transaction.get(commentRef),
        transaction.get(replyRef),
        transaction.get(requestRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        if (
          existing['kind'] !== 'comment_reply_action'
          || existing['actorUid'] !== actorUid
          || existing['communityId'] !== communityId
          || existing['postId'] !== postId
          || existing['commentId'] !== commentId
          || existing['replyId'] !== replyId
          || existing['action'] !== action
        ) {
          throw new HttpsError(
            'already-exists',
            'Este identificador já foi utilizado.',
            { reason: 'request_id_conflict' }
          );
        }
        const status = normalizeStatus(existing['status']);
        const generatedAt = Number(existing['completedAt']);
        if (!status || !Number.isFinite(generatedAt)) {
          throw new HttpsError(
            'data-loss',
            'O registro da ação está inconsistente.',
            { reason: 'moderation_record_inconsistent' }
          );
        }
        return {
          communityId,
          postId,
          commentId,
          replyId,
          action,
          status,
          replyCount: normalizeCount(existing['replyCount']),
          deduplicated: true,
          generatedAt: Math.trunc(generatedAt),
        };
      }

      if (!communitySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comunidade não encontrada.',
          { reason: 'community_not_found' }
        );
      }
      if (!postSnapshot.exists || !commentSnapshot.exists || !replySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Resposta não encontrada.',
          { reason: 'community_feed_reply_not_found' }
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
      const reply = replySnapshot.data() ?? {};
      const decision = evaluateCommunityFeedCommentAction({
        action,
        sourceType: source['type'],
        memberActivityAllowed:
          moderation['state'] === 'active'
          && isCommunityMemberActivityEnabledStatus(community['status']),
        actorUid,
        authorUid: String(reply['actorUid'] ?? '').trim(),
        membershipStatus: membership['status'],
        viewerRole: normalizeRole(membership['role']),
        currentStatus: normalizeStatus(reply['status']),
        currentModerationState: normalizeModerationState(reply['moderationState']),
        reason: command.reason,
      });

      if (!decision.allowed || !decision.nextStatus || !decision.nextModerationState) {
        throwDenied(decision.denialReason);
      }

      const nowMs = Date.now();
      const authorUid = String(reply['actorUid'] ?? '').trim();
      let notificationRef: FirebaseFirestore.DocumentReference | null = null;

      if (
        action === 'remove'
        && !decision.idempotent
        && authorUid
        && authorUid !== actorUid
      ) {
        const authorUserSnapshot = await transaction.get(
          db.collection('users').doc(authorUid)
        );
        const authorUser = authorUserSnapshot.data() as
          | CommunityNotificationUser
          | undefined;

        if (canReceiveCommunityEssentialNotification(
          authorUser,
          authorUid,
          actorUid
        )) {
          notificationRef = db.collection('notifications').doc(
            buildCommunityModerationNotificationId(
              'reply',
              requestId,
              authorUid
            )
          );
        }
      }

      const comment = commentSnapshot.data() ?? {};
      const metrics = (comment['metrics'] ?? {}) as Record<string, unknown>;
      const currentCount = normalizeCount(metrics['replyCount']);
      const replyCount = decision.idempotent
        ? currentCount
        : Math.max(0, currentCount - 1);
      const now = Timestamp.fromMillis(nowMs);

      if (!decision.idempotent) {
        transaction.update(replyRef, {
          status: decision.nextStatus,
          moderationState: decision.nextModerationState,
          text: action === 'delete_own' ? '' : reply['text'],
          actionReason: action === 'remove' ? command.reason : null,
          actionedAt: now,
          updatedAt: now,
        });
        transaction.update(commentRef, {
          'metrics.replyCount': replyCount,
          updatedAt: now,
        });
        transaction.create(auditRef, {
          action: action === 'delete_own'
            ? 'community-feed-comment-reply-deleted-by-author'
            : 'community-feed-comment-reply-removed-by-management',
          actorUid,
          actorRole: normalizeRole(membership['role']),
          communityId,
          postId,
          commentId,
          replyId,
          reason: action === 'remove' ? command.reason : null,
          createdAt: nowMs,
        });

        if (notificationRef) {
          const copy = buildCommunityModerationNotificationCopy({
            target: 'reply',
            communityName: community['name'],
          });
          transaction.set(notificationRef, {
            userId: authorUid,
            type: 'community.content.moderated',
            title: copy.title,
            body: copy.body,
            route: buildCommunityNotificationRoute(communityId),
            communityId,
            postId,
            commentId,
            replyId,
            moderationTarget: 'reply',
            actorUid,
            readAt: null,
            createdAt: now,
            updatedAt: now,
          }, { merge: true });
        }
      }

      transaction.create(requestRef, {
        requestId,
        kind: 'comment_reply_action',
        actorUid,
        communityId,
        postId,
        commentId,
        replyId,
        action,
        status: decision.nextStatus,
        replyCount,
        idempotent: decision.idempotent,
        completedAt: nowMs,
        createdAt: nowMs,
      });

      return {
        communityId,
        postId,
        commentId,
        replyId,
        action,
        status: decision.nextStatus,
        replyCount,
        deduplicated: decision.idempotent,
        generatedAt: nowMs,
      };
    });
  }
);
