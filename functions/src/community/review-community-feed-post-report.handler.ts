// -----------------------------------------------------------------------------
// REVIEW COMMUNITY FEED POST REPORT
// -----------------------------------------------------------------------------
// Decisão administrativa autoritativa. KEEP encerra a denúncia; REMOVE também
// retira a projeção e atualiza métricas sem apagar a evidência operacional.
// A mídia física só é liberada após o último report bloqueante ser encerrado.
// -----------------------------------------------------------------------------

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  safeRecordModerationReviewSignal,
} from '../moderation/moderation-automation.service';
import {
  safeNotifyModerationReportReviewed,
} from '../moderation/moderation-safety-notification.service';
import {
  deletePublishedPhotoAssetOrQueue,
  stagePublishedPhotoAssetCleanup,
  type StagedPublishedPhotoAssetCleanup,
} from '../media/application/published-photo-asset.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  hasBlockingCommunityFeedPostReportInTransaction,
} from './community-feed-moderation-evidence.service';
import {
  buildCommunityModerationNotificationCopy,
  buildCommunityModerationNotificationId,
  buildCommunityNotificationRoute,
  canReceiveCommunityEssentialNotification,
  type CommunityNotificationUser,
} from './community-notification.policy';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

interface ReviewCommunityFeedPostReportRequest {
  reportId?: unknown;
  decision?: unknown;
  resolution?: unknown;
}

type ReviewDecision = 'KEEP' | 'REMOVE';

interface ReviewTransactionResult {
  cleanup: StagedPublishedPhotoAssetCleanup | null;
  authorUid: string;
  critical: boolean;
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A revisão de denúncias do Mural ainda não está disponível neste ambiente.'
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
  const allowed = token['admin'] === true
    || token['role'] === 'admin'
    || roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }
  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem revisar denúncias do Mural.'
    );
  }
  return adminUid;
}

export const reviewCommunityFeedPostReport = onCall<
  ReviewCommunityFeedPostReportRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<{
    reportId: string;
    decision: ReviewDecision;
    targetType: 'community_feed_post';
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

    const transactionResult = await db.runTransaction(async (transaction): Promise<ReviewTransactionResult> => {
      const reportRef = db.collection('moderation_reports').doc(reportId);
      const reportSnapshot = await transaction.get(reportRef);
      if (!reportSnapshot.exists) {
        throw new HttpsError('not-found', 'Denúncia não encontrada.');
      }

      const report = reportSnapshot.data() ?? {};
      const status = String(report['status'] ?? '').trim().toLowerCase();
      const communityId = cleanId(report['parentTargetId']);
      const postId = cleanId(report['targetId']);
      const authorUid = cleanId(report['targetAuthorUid']);
      const critical = report['reason'] === 'minor_content_safety';

      if (
        report['targetType'] !== 'community_feed_post'
        || !communityId
        || !postId
        || !authorUid
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A denúncia não possui referências válidas do Mural.'
        );
      }
      if (status !== 'open' && status !== 'reviewing') {
        throw new HttpsError('failed-precondition', 'Esta denúncia já foi encerrada.');
      }

      const communityRef = db.collection('communities').doc(communityId);
      const discoveryRef = db.collection('community_discovery_index').doc(communityId);
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
      const authorUserRef = db.collection('users').doc(authorUid);
      const adminLogRef = db.collection('admin_logs').doc();
      const actorActionRef = db
        .collection('community_feed_user_actions')
        .doc(adminUid)
        .collection('items')
        .doc(`${communityId}:${postId}`);
      const hasOtherBlockingReports = await hasBlockingCommunityFeedPostReportInTransaction(
        transaction,
        communityId,
        postId,
        reportId
      );
      const [
        communitySnapshot,
        discoverySnapshot,
        postSnapshot,
        projectionSnapshot,
        authorUserSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(discoveryRef),
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(authorUserRef),
      ]);

      if (!postSnapshot.exists) {
        throw new HttpsError('not-found', 'Publicação denunciada não encontrada.');
      }

      const post = postSnapshot.data() ?? {};
      if (cleanId(post['actorUid']) !== authorUid) {
        throw new HttpsError(
          'failed-precondition',
          'A publicação não corresponde às referências da denúncia.'
        );
      }
      const contentActive = post['status'] === 'active'
        && post['moderationState'] === 'active';
      const contentQuarantined = post['status'] === 'active'
        && post['moderationState'] === 'quarantined';
      const contentReviewable = contentActive || contentQuarantined;
      const photoPost = post['kind'] === 'photo';
      const timestamp = FieldValue.serverTimestamp();
      const nowMs = Date.now();
      const authorUser = authorUserSnapshot.data() as
        | CommunityNotificationUser
        | undefined;
      const shouldNotifyRemoval = decision === 'REMOVE'
        && contentReviewable
        && canReceiveCommunityEssentialNotification(
          authorUser,
          authorUid,
          adminUid
        );

      let cleanup: StagedPublishedPhotoAssetCleanup | null = null;
      if (
        photoPost
        && !hasOtherBlockingReports
        && (
          decision === 'REMOVE'
          || post['status'] !== 'active'
          || post['moderationState'] === 'removed'
        )
      ) {
        const image = (post['image'] ?? {}) as Record<string, unknown>;
        const storagePath = String(image['storagePath'] ?? '').trim();
        if (storagePath) {
          cleanup = stagePublishedPhotoAssetCleanup(transaction, {
            ownerUid: authorUid,
            photoId: postId,
            storagePath,
            reason: 'community-feed-post-report-review-closed',
            retentionGuard: {
              targetType: 'community_feed_post',
              targetId: postId,
              parentTargetId: communityId,
            },
          });
        }
      }

      if (decision === 'KEEP' && contentQuarantined) {
        transaction.update(postRef, {
          moderationState: 'active',
          moderationQuarantineReason: FieldValue.delete(),
          moderationQuarantinedAt: FieldValue.delete(),
          updatedAt: timestamp,
        });
      }

      if (decision === 'REMOVE' && contentReviewable) {
        transaction.update(postRef, {
          status: 'removed',
          moderationState: 'removed',
          actionedAt: timestamp,
          actionedBy: adminUid,
          actionReason: resolution,
          updatedAt: timestamp,
        });
        if (projectionSnapshot.exists) transaction.delete(projectionRef);
        transaction.set(actorActionRef, {
          actorUid: adminUid,
          communityId,
          postId,
          createdAt: nowMs,
        });

        if (communitySnapshot.exists) {
          const community = communitySnapshot.data() ?? {};
          const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;
          const postCount = normalizeCount(metrics['postCount']);
          const mediaCount = normalizeCount(metrics['mediaCount']);
          transaction.update(communityRef, {
            'metrics.postCount': Math.max(0, postCount - 1),
            ...(photoPost
              ? { 'metrics.mediaCount': Math.max(0, mediaCount - 1) }
              : {}),
            updatedAt: nowMs,
          });
        }
        if (discoverySnapshot.exists) {
          const discovery = discoverySnapshot.data() ?? {};
          const metrics = (discovery['metrics'] ?? {}) as Record<string, unknown>;
          const postCount = normalizeCount(metrics['postCount']);
          const mediaCount = normalizeCount(metrics['mediaCount']);
          transaction.update(discoveryRef, {
            'metrics.postCount': Math.max(0, postCount - 1),
            ...(photoPost
              ? { 'metrics.mediaCount': Math.max(0, mediaCount - 1) }
              : {}),
            updatedAt: nowMs,
          });
        }
        if (shouldNotifyRemoval) {
          const community = communitySnapshot.data() ?? {};
          const copy = buildCommunityModerationNotificationCopy({
            target: 'post',
            communityName: community['name'],
          });
          const notificationRef = db.collection('notifications').doc(
            buildCommunityModerationNotificationId(
              'post',
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
            moderationTarget: 'post',
            actorUid: adminUid,
            readAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          }, { merge: true });
        }
      }

      if (photoPost) {
        transaction.update(postRef, {
          moderationEvidenceMediaHold: hasOtherBlockingReports,
        });
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
        action: 'communityFeedPostReportReview',
        targetUserUid: authorUid,
        details: {
          reportId,
          communityId,
          postId,
          decision,
          contentActiveAtReview: contentActive,
          resolution,
        },
        timestamp,
      });

      return { cleanup, authorUid, critical };
    });

    await safeRecordModerationReviewSignal({
      reportId,
      targetUid: transactionResult.authorUid,
      critical: transactionResult.critical,
      confirmed: decision === 'REMOVE',
    });

    await safeNotifyModerationReportReviewed(reportId);

    if (transactionResult.cleanup) {
      try {
        await deletePublishedPhotoAssetOrQueue(transactionResult.cleanup);
      } catch (error) {
        logger.error('[communityFeed] Limpeza da mídia após revisão falhou; job preservado.', {
          reportId,
          error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        });
      }
    }

    return { reportId, decision, targetType: 'community_feed_post' };
  }
);
