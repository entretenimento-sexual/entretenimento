// -----------------------------------------------------------------------------
// REVIEW COMMUNITY FEED COMMENT REPLY REPORT
// -----------------------------------------------------------------------------
// A revisão administrativa mantém a resposta ou a remove de forma atômica,
// atualizando o contador do comentário pai e a trilha de auditoria.
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

interface ReviewCommunityFeedCommentReplyReportRequest {
  reportId?: unknown;
  decision?: unknown;
  resolution?: unknown;
}

type ReviewDecision = 'KEEP' | 'REMOVE';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A revisão de respostas ainda não está disponível neste ambiente.'
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
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), 1_000_000_000)
    : 0;
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
      'Apenas administradores podem revisar respostas denunciadas.'
    );
  }
  return adminUid;
}

export const reviewCommunityFeedCommentReplyReport = onCall<
  ReviewCommunityFeedCommentReplyReportRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<{
    reportId: string;
    decision: ReviewDecision;
    targetType: 'community_feed_comment_reply';
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
      const postId = cleanId(report['grandparentTargetId']);
      const commentId = cleanId(report['parentTargetId']);
      const replyId = cleanId(report['targetId']);
      const authorUid = cleanId(report['targetAuthorUid']);

      if (
        report['targetType'] !== 'community_feed_comment_reply'
        || !communityId
        || !postId
        || !commentId
        || !replyId
        || !authorUid
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A denúncia não possui referências válidas da resposta.'
        );
      }
      if (status !== 'open' && status !== 'reviewing') {
        throw new HttpsError('failed-precondition', 'Esta denúncia já foi encerrada.');
      }

      const communityRef = db.collection('communities').doc(communityId);
      const commentRef = db
        .collection('community_feed_posts')
        .doc(communityId)
        .collection('items')
        .doc(postId)
        .collection('comments')
        .doc(commentId);
      const replyRef = commentRef.collection('replies').doc(replyId);
      const authorUserRef = db.collection('users').doc(authorUid);
      const adminLogRef = db.collection('admin_logs').doc();

      const [
        communitySnapshot,
        commentSnapshot,
        replySnapshot,
        authorUserSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(commentRef),
        transaction.get(replyRef),
        transaction.get(authorUserRef),
      ]);

      if (!commentSnapshot.exists || !replySnapshot.exists) {
        throw new HttpsError('not-found', 'Resposta denunciada não encontrada.');
      }

      const reply = replySnapshot.data() ?? {};
      if (
        cleanId(reply['communityId']) !== communityId
        || cleanId(reply['postId']) !== postId
        || cleanId(reply['commentId']) !== commentId
        || cleanId(reply['replyId']) !== replyId
        || cleanId(reply['actorUid']) !== authorUid
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A resposta não corresponde às referências da denúncia.'
        );
      }

      const contentActive = reply['status'] === 'active'
        && reply['moderationState'] === 'active';
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
        const comment = commentSnapshot.data() ?? {};
        const metrics = (comment['metrics'] ?? {}) as Record<string, unknown>;
        const replyCount = Math.max(
          0,
          normalizeCount(metrics['replyCount']) - 1
        );

        transaction.update(replyRef, {
          status: 'removed',
          moderationState: 'removed',
          actionReason: resolution,
          actionedAt: timestamp,
          updatedAt: timestamp,
        });
        transaction.update(commentRef, {
          'metrics.replyCount': replyCount,
          updatedAt: timestamp,
        });

        if (shouldNotifyRemoval) {
          const community = communitySnapshot.data() ?? {};
          const copy = buildCommunityModerationNotificationCopy({
            target: 'reply',
            communityName: community['name'],
          });
          const notificationRef = db.collection('notifications').doc(
            buildCommunityModerationNotificationId(
              'reply',
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
            replyId,
            moderationTarget: 'reply',
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
        action: 'communityFeedCommentReplyReportReview',
        targetUserUid: authorUid,
        details: {
          reportId,
          communityId,
          postId,
          commentId,
          replyId,
          decision,
          contentActiveAtReview: contentActive,
          resolution,
        },
        timestamp,
      });
    });

    return {
      reportId,
      decision,
      targetType: 'community_feed_comment_reply',
    };
  }
);
