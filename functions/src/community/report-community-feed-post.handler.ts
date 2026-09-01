// -----------------------------------------------------------------------------
// REPORT COMMUNITY FEED POST
// -----------------------------------------------------------------------------
// Denúncia autoritativa: revalida a legibilidade do alvo, impede autodenúncia e
// cria uma única ocorrência aberta por usuário/publicação.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertInteractionAccess } from '../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { canViewerReadCommunityFeedAudience } from './community-feed-access.policy';
import {
  CommunityFeedReportRequest,
  normalizeCommunityFeedReportRequest,
} from './community-feed-report.model';
import { sanitizeCommunityFeedProjection } from './community-feed.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertFeedRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'As denúncias do Mural ainda não estão disponíveis neste ambiente.'
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
  postId: string
): string {
  return createHash('sha256')
    .update([reporterUid, 'community_feed_post', communityId, postId].join('|'))
    .digest('hex')
    .slice(0, 48);
}

export const reportCommunityFeedPost = onCall<CommunityFeedReportRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<{ reportId: string }> => {
    assertFeedRuntime();
    assertCommunityCallableAppCheck(request.app);
    const reporterUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedReportRequest(request.data);

    if (!command.communityId || !command.postId || !command.reason) {
      throw new HttpsError('invalid-argument', 'Denúncia de publicação inválida.');
    }

    await consumeCommunityRateLimit({
      action: 'feed_report_post',
      actorUid: reporterUid,
    });
    await assertInteractionAccess(reporterUid);

    const context = await getCommunityViewerContext(
      reporterUid,
      command.communityId
    );
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
    const reportId = buildReportId(
      reporterUid,
      command.communityId,
      command.postId
    );
    const reportRef = db.collection('moderation_reports').doc(reportId);

    await db.runTransaction(async (transaction) => {
      const [postSnapshot, projectionSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(reportRef),
      ]);

      if (!postSnapshot.exists || !projectionSnapshot.exists) {
        throw new HttpsError('not-found', 'Publicação não encontrada.');
      }
      if (reportSnapshot.exists) {
        throw new HttpsError('already-exists', 'Você já denunciou esta publicação.');
      }

      const post = postSnapshot.data() ?? {};
      const authorUid = String(post['actorUid'] ?? '').trim();
      const projection = sanitizeCommunityFeedProjection(
        command.postId!,
        projectionSnapshot.data()
      );

      if (
        post['status'] !== 'active'
        || post['moderationState'] !== 'active'
        || !authorUid
        || !projection
        || !canViewerReadCommunityFeedAudience(
          projection,
          context.memberContentAccess
        )
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Esta publicação não está disponível para denúncia.'
        );
      }
      if (authorUid === reporterUid) {
        throw new HttpsError(
          'failed-precondition',
          'Você não pode denunciar a própria publicação.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();
      transaction.create(reportRef, {
        reporterUid,
        targetType: 'community_feed_post',
        targetId: command.postId,
        parentTargetId: command.communityId,
        targetOwnerUid: null,
        targetAuthorUid: authorUid,
        reason: command.reason,
        details: command.details,
        route: command.route,
        status: 'open',
        moderationAction: null,
        source: 'web',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    return { reportId };
  }
);
