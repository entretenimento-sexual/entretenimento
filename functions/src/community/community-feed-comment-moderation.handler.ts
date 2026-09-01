// -----------------------------------------------------------------------------
// MODERATE COMMUNITY FEED COMMENT
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
  CommunityFeedCommentActionRequest,
  CommunityFeedCommentActionResponse,
  CommunityFeedCommentStatus,
  normalizeCommunityFeedCommentActionRequest,
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
    'As ações de comentário ainda não estão disponíveis neste ambiente.',
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
      'Somente o autor pode excluir o comentário.',
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
    'Este comentário não permite a ação.',
    { reason: reason ?? 'comment_unavailable' }
  );
}

export const moderateCommunityFeedComment = onCall<
  CommunityFeedCommentActionRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedCommentActionResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedCommentActionRequest(request.data);
    if (
      !command.requestId
      || !command.communityId
      || !command.postId
      || !command.commentId
      || !command.action
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Ação de comentário inválida.',
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
    const action = command.action;
    const requestId = command.requestId;

    if (action === 'remove') {
      await consumeCommunityRateLimit({
        action: 'content_moderation',
        actorUid,
      });
    }

    return db.runTransaction(async (transaction): Promise<CommunityFeedCommentActionResponse> => {
      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
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
      const requestRef = db
        .collection('community_feed_requests')
        .doc(requestId);
      const auditRef = db
        .collection('community_feed_audit')
        .doc(`comment-action-${requestId}`);
      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        postSnapshot,
        projectionSnapshot,
        commentSnapshot,
        requestSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(commentRef),
        transaction.get(requestRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        if (
          existing['kind'] !== 'comment_action'
          || existing['actorUid'] !== actorUid
          || existing['communityId'] !== communityId
          || existing['postId'] !== postId
          || existing['commentId'] !== commentId
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
          action,
          status,
          commentCount: normalizeCount(existing['commentCount']),
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
      if (!postSnapshot.exists || !commentSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comentário não encontrado.',
          { reason: 'community_feed_comment_not_found' }
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
      const comment = commentSnapshot.data() ?? {};
      const decision = evaluateCommunityFeedCommentAction({
        action,
        sourceType: source['type'],
        memberActivityAllowed:
          moderation['state'] === 'active'
          && isCommunityMemberActivityEnabledStatus(community['status']),
        actorUid,
        authorUid: String(comment['actorUid'] ?? '').trim(),
        membershipStatus: membership['status'],
        viewerRole: normalizeRole(membership['role']),
        currentStatus: normalizeStatus(comment['status']),
        currentModerationState: normalizeModerationState(
          comment['moderationState']
        ),
        reason: command.reason,
      });
      if (!decision.allowed || !decision.nextStatus || !decision.nextModerationState) {
        throwDenied(decision.denialReason);
      }

      const nowMs = Date.now();
      const authorUid = String(comment['actorUid'] ?? '').trim();
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
              'comment',
              requestId,
              authorUid
            )
          );
        }
      }

      const post = postSnapshot.data() ?? {};
      const metrics = (post['metrics'] ?? {}) as Record<string, unknown>;
      const currentCount = normalizeCount(metrics['commentCount']);
      const commentCount = decision.idempotent
        ? currentCount
        : Math.max(0, currentCount - 1);
      const now = Timestamp.fromMillis(nowMs);

      if (!decision.idempotent) {
        transaction.update(commentRef, {
          status: decision.nextStatus,
          moderationState: decision.nextModerationState,
          text: action === 'delete_own' ? '' : comment['text'],
          actionReason: action === 'remove' ? command.reason : null,
          actionedAt: now,
          updatedAt: now,
        });
        transaction.update(postRef, {
          'metrics.commentCount': commentCount,
          updatedAt: now,
        });
        if (projectionSnapshot.exists) {
          transaction.update(projectionRef, {
            'metrics.commentCount': commentCount,
            updatedAt: now,
          });
        }
        transaction.create(auditRef, {
          action: action === 'delete_own'
            ? 'community-feed-comment-deleted-by-author'
            : 'community-feed-comment-removed-by-management',
          actorUid,
          actorRole: normalizeRole(membership['role']),
          communityId,
          postId,
          commentId,
          reason: action === 'remove' ? command.reason : null,
          createdAt: nowMs,
        });
        if (notificationRef) {
          const copy = buildCommunityModerationNotificationCopy({
            target: 'comment',
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
            moderationTarget: 'comment',
            actorUid,
            readAt: null,
            createdAt: now,
            updatedAt: now,
          }, { merge: true });
        }
      }
      transaction.create(requestRef, {
        requestId,
        kind: 'comment_action',
        actorUid,
        communityId,
        postId,
        commentId,
        action,
        status: decision.nextStatus,
        commentCount,
        idempotent: decision.idempotent,
        completedAt: nowMs,
        createdAt: nowMs,
      });

      return {
        communityId,
        postId,
        commentId,
        action,
        status: decision.nextStatus,
        commentCount,
        deduplicated: decision.idempotent,
        generatedAt: nowMs,
      };
    });
  }
);
