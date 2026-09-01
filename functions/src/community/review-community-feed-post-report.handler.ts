// -----------------------------------------------------------------------------
// REVIEW COMMUNITY FEED POST REPORT
// -----------------------------------------------------------------------------
// Decisão administrativa autoritativa. KEEP encerra a denúncia; REMOVE também
// retira a projeção e atualiza métricas sem apagar a evidência operacional.
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

interface ReviewCommunityFeedPostReportRequest {
  reportId?: unknown;
  decision?: unknown;
  resolution?: unknown;
}

type ReviewDecision = 'KEEP' | 'REMOVE';

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

    await db.runTransaction(async (transaction) => {
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
      const timestamp = FieldValue.serverTimestamp();
      const nowMs = Date.now();
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
          const postCount = normalizeCount(
            ((community['metrics'] ?? {}) as Record<string, unknown>)['postCount']
          );
          transaction.update(communityRef, {
            'metrics.postCount': Math.max(0, postCount - 1),
            updatedAt: nowMs,
          });
        }
        if (discoverySnapshot.exists) {
          const discovery = discoverySnapshot.data() ?? {};
          const postCount = normalizeCount(
            ((discovery['metrics'] ?? {}) as Record<string, unknown>)['postCount']
          );
          transaction.update(discoveryRef, {
            'metrics.postCount': Math.max(0, postCount - 1),
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
    });

    return { reportId, decision, targetType: 'community_feed_post' };
  }
);
