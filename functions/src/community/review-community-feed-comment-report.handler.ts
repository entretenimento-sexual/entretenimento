// -----------------------------------------------------------------------------
// REVIEW COMMUNITY FEED COMMENT REPORT
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  buildCommunityModerationNotificationCopy,
  buildCommunityModerationNotificationId,
  buildCommunityNotificationRoute,
  canReceiveCommunityEssentialNotification,
  type CommunityNotificationUser,
} from './community-notification.policy';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

interface ReviewCommunityFeedCommentReportRequest {
  reportId?: unknown;
  decision?: unknown;
  resolution?: unknown;
}

type ReviewDecision = 'KEEP' | 'REMOVE';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A revisão de comentários ainda não está disponível neste ambiente.'
  );
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanDecision(value: unknown): ReviewDecision | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'KEEP' || normalized === 'REMOVE' ? normalized : null;
}

function cleanResolution(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function assertAdmin(requestAuth: unknown): string {
  const auth = (requestAuth ?? {}) as {
    uid?: unknown;
    token?: Record<string, unknown>;
  };
  const adminUid = cleanId(auth.uid);
  const token = auth.token ?? {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }
  if (
    token['admin'] !== true
    && token['role'] !== 'admin'
    && !roles.includes('admin')
  ) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem revisar comentários denunciados.'
    );
  }
  return adminUid;
}

export const reviewCommunityFeedCommentReport = onCall<
  ReviewCommunityFeedCommentReportRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<{
    reportId: string;
    decision: ReviewDecision;
    targetType: 'community_feed_comment';
  }> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const adminUid = assertAdmin(request.auth);
    const reportId = cleanId(request.data?.reportId);
    const decision = cleanDecision(request.data?.decision);
    const resolution = cleanResolution(request.data?.resolution);
    if (!reportId || !decision || resolution.length < 8) {
      throw new HttpsError('invalid-argument', 'Decisão de denúncia inválida.');
    }

    await consumeCommunityRateLimit({
      action: 'content_moderation',
      actorUid: adminUid,
    });

    await db.runTransaction(async (transaction) => {
      const reportRef = db.collection('moderation_reports').doc(reportId);
      const reportSnapshot = await transaction.get(reportRef);
      if (!reportSnapshot.exists) {
        throw new HttpsError('not-found', 'Denúncia não encontrada.');
      }
      const report = reportSnapshot.data() ?? {};
      const status = String(report['status'] ?? '').trim().toLowerCase();
      const communityId = cleanId(report['containerTargetId']);
      const postId = cleanId(report['parentTargetId']);
      const commentId = cleanId(report['targetId']);
      const authorUid = cleanId(report['targetAuthorUid']);
      if (
        report['targetType'] !== 'community_feed_comment'
        || !communityId
        || !postId
        || !commentId
        || !authorUid
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A denúncia não possui referências válidas do comentário.'
        );
      }
      if (status !== 'open' && status !== 'reviewing') {
        throw new HttpsError('failed-precondition', 'Esta denúncia já foi encerrada.');
      }

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
      const communityRef = db.collection('communities').doc(communityId);
      const authorUserRef = db.collection('users').doc(authorUid);
      const adminLogRef = db.collection('admin_logs').doc();
      const [
        communitySnapshot,
        postSnapshot,
        projectionSnapshot,
        commentSnapshot,
        authorUserSnapshot,
      ] =
        await Promise.all([
          transaction.get(communityRef),
          transaction.get(postRef),
          transaction.get(projectionRef),
          transaction.get(commentRef),
          transaction.get(authorUserRef),
        ]);
      if (!postSnapshot.exists || !commentSnapshot.exists) {
        throw new HttpsError('not-found', 'Comentário denunciado não encontrado.');
      }

      const post = postSnapshot.data() ?? {};
      const comment = commentSnapshot.data() ?? {};
      if (
        cleanId(comment['communityId']) !== communityId
        || cleanId(comment['postId']) !== postId
        || cleanId(comment['commentId']) !== commentId
        || cleanId(comment['actorUid']) !== authorUid
      ) {
        throw new HttpsError(
          'failed-precondition',
          'O comentário não corresponde às referências da denúncia.'
        );
      }
      const contentActive = comment['status'] === 'active'
        && comment['moderationState'] === 'active';
      const timestamp = FieldValue.serverTimestamp();
      const authorUser = authorUserSnapshot.data() as
        | CommunityNotificationUser
        | undefined;
      const shouldNotifyRemoval = decision === 'REMOVE'
        && contentActive
        && canReceiveCommunityEssentialNotification(
          authorUser,
          authorUid,
          adminUid
        );

      if (decision === 'REMOVE' && contentActive) {
        const metrics = (post['metrics'] ?? {}) as Record<string, unknown>;
        const commentCount = Math.max(
          0,
          normalizeCount(metrics['commentCount']) - 1
        );
        transaction.update(commentRef, {
          status: 'removed',
          moderationState: 'removed',
          actionReason: resolution,
          actionedAt: timestamp,
          updatedAt: timestamp,
        });
        transaction.update(postRef, {
          'metrics.commentCount': commentCount,
          updatedAt: timestamp,
        });
        if (projectionSnapshot.exists) {
          transaction.update(projectionRef, {
            'metrics.commentCount': commentCount,
            updatedAt: timestamp,
          });
        }
        if (shouldNotifyRemoval) {
          const community = communitySnapshot.data() ?? {};
          const copy = buildCommunityModerationNotificationCopy({
            target: 'comment',
            communityName: community['name'],
          });
          const notificationRef = db.collection('notifications').doc(
            buildCommunityModerationNotificationId(
              'comment',
              `report:${reportId}`,
              authorUid
            )
          );
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
            actorUid: adminUid,
            readAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          }, { merge: true });
        }
      }

      transaction.update(reportRef, {
        status: decision === 'KEEP' ? 'rejected' : 'resolved',
        moderationAction: decision,
        resolution,
        reviewedBy: adminUid,
        reviewedAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.set(adminLogRef, {
        adminUid,
        action: 'communityFeedCommentReportReview',
        targetUserUid: authorUid,
        details: {
          reportId,
          communityId,
          postId,
          commentId,
          decision,
          contentActiveAtReview: contentActive,
          resolution,
        },
        timestamp,
      });
    });

    return { reportId, decision, targetType: 'community_feed_comment' };
  }
);
