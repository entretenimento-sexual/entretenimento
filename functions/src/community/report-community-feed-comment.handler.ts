// -----------------------------------------------------------------------------
// REPORT COMMUNITY FEED COMMENT
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertInteractionAccess } from '../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  safeRecordModerationOpenSignal,
} from '../moderation/moderation-automation.service';
import {
  consumeMinorSafetyReporterQuota,
  isMinorSafetyReportReason,
} from '../moderation/moderation-minor-safety-report-security.service';
import {
  safeNotifyModerationReportOpened,
} from '../moderation/moderation-safety-notification.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  canViewerReadCommunityFeedAudience,
  resolveCommunityFeedContentAccess,
} from './community-feed-access.policy';
import { sanitizeCommunityFeedComment } from './community-feed-comment.model';
import { isCommunityFeedInteractivePostKind } from './community-feed-comment.policy';
import {
  assertCommunityFeedReportAccessInTransaction,
} from './community-feed-report-access.service';
import {
  CommunityFeedCommentReportRequest,
  normalizeCommunityFeedCommentReportRequest,
} from './community-feed-report.model';
import { sanitizeCommunityFeedProjection } from './community-feed.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'As denúncias de comentários ainda não estão disponíveis neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
  }
  return uid;
}

function buildReportId(
  reporterUid: string,
  communityId: string,
  postId: string,
  commentId: string
): string {
  return createHash('sha256')
    .update([
      reporterUid,
      'community_feed_comment',
      communityId,
      postId,
      commentId,
    ].join('|'))
    .digest('hex')
    .slice(0, 48);
}

export const reportCommunityFeedComment = onCall<
  CommunityFeedCommentReportRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<{ reportId: string }> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const reporterUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedCommentReportRequest(request.data);
    if (
      !command.communityId
      || !command.postId
      || !command.commentId
      || !command.reason
    ) {
      throw new HttpsError('invalid-argument', 'Denúncia de comentário inválida.');
    }

    await consumeCommunityRateLimit({
      action: 'feed_report_comment',
      actorUid: reporterUid,
    });
    if (isMinorSafetyReportReason(command.reason)) {
      await consumeMinorSafetyReporterQuota({ reporterUid });
    }
    await assertInteractionAccess(reporterUid);
    await getCommunityViewerContext(reporterUid, command.communityId);

    const postRef = db
      .collection('community_feed_posts')
      .doc(command.communityId)
      .collection('items')
      .doc(command.postId);
    const projectionRef = db
      .collection('community_public_feed')
      .doc(command.communityId)
      .collection('items')
      .doc(command.postId);
    const commentRef = postRef.collection('comments').doc(command.commentId);
    const reportId = buildReportId(
      reporterUid,
      command.communityId,
      command.postId,
      command.commentId
    );
    const reportRef = db.collection('moderation_reports').doc(reportId);

    const automationTarget = await db.runTransaction(async (transaction) => {
      const [
        reportAccess,
        postSnapshot,
        projectionSnapshot,
        commentSnapshot,
        reportSnapshot,
      ] = await Promise.all([
        assertCommunityFeedReportAccessInTransaction(
          transaction,
          reporterUid,
          command.communityId!
        ),
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(commentRef),
        transaction.get(reportRef),
      ]);
      if (
        !postSnapshot.exists
        || !projectionSnapshot.exists
        || !commentSnapshot.exists
      ) {
        throw new HttpsError('not-found', 'Comentário não encontrado.');
      }
      if (reportSnapshot.exists) {
        throw new HttpsError('already-exists', 'Você já denunciou este comentário.');
      }

      const post = postSnapshot.data() ?? {};
      const postKind = post['kind'];
      const projection = sanitizeCommunityFeedProjection(
        command.postId!,
        projectionSnapshot.data()
      );
      const comment = sanitizeCommunityFeedComment(
        command.commentId!,
        commentSnapshot.data()
      );
      const feedContentAccess = resolveCommunityFeedContentAccess(
        reportAccess.memberContentAccess,
        reportAccess.authenticatedPreviewAccess
      );
      if (
        !isCommunityFeedInteractivePostKind(postKind)
        || post['status'] !== 'active'
        || post['moderationState'] !== 'active'
        || !projection
        || projection.item.kind !== postKind
        || !comment
        || !canViewerReadCommunityFeedAudience(
          projection,
          feedContentAccess
        )
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este comentário não está disponível para denúncia.'
        );
      }
      if (comment.actorUid === reporterUid) {
        throw new HttpsError(
          'failed-precondition',
          'Você não pode denunciar o próprio comentário.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();
      const criticalQuarantine = command.reason === 'minor_content_safety';
      transaction.create(reportRef, {
        reporterUid,
        targetType: 'community_feed_comment',
        targetId: command.commentId,
        parentTargetId: command.postId,
        containerTargetId: command.communityId,
        targetOwnerUid: null,
        targetAuthorUid: comment.actorUid,
        reason: command.reason,
        details: command.details,
        route: command.route,
        status: 'open',
        moderationAction: null,
        contentQuarantined: criticalQuarantine,
        legalReviewStatus: command.reason === 'minor_content_safety'
          ? 'PENDING_LEGAL_REVIEW'
          : null,
        source: 'web',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      if (criticalQuarantine) {
        transaction.update(commentRef, {
          moderationState: 'quarantined',
          moderationQuarantineReason: 'minor_content_safety',
          moderationQuarantinedAt: timestamp,
          updatedAt: timestamp,
        });
      }

      return {
        authorUid: comment.actorUid,
        quarantined: criticalQuarantine,
      };
    });

    await safeRecordModerationOpenSignal({
      reportId,
      targetUid: automationTarget.authorUid,
      reporterUid,
      targetKey: `community-comment:${command.communityId}:${command.postId}:${command.commentId}`,
      critical: command.reason === 'minor_content_safety',
      quarantined: automationTarget.quarantined,
    });

    await safeNotifyModerationReportOpened(reportId);

    return { reportId };
  }
);
