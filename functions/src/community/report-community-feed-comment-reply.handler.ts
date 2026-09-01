// -----------------------------------------------------------------------------
// REPORT COMMUNITY FEED COMMENT REPLY
// -----------------------------------------------------------------------------
// A denúncia de resposta revalida toda a cadeia pública (post -> comentário ->
// resposta) no backend. O navegador envia apenas as referências necessárias.
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
import {
  canViewerReadCommunityFeedAudience,
  resolveCommunityFeedContentAccess,
} from './community-feed-access.policy';
import {
  sanitizeCommunityFeedComment,
  sanitizeCommunityFeedCommentReply,
} from './community-feed-comment.model';
import { isCommunityFeedInteractivePostKind } from './community-feed-comment.policy';
import {
  CommunityFeedCommentReplyReportRequest,
  normalizeCommunityFeedCommentReplyReportRequest,
} from './community-feed-report.model';
import { sanitizeCommunityFeedProjection } from './community-feed.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'As denúncias de respostas ainda não estão disponíveis neste ambiente.'
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
  commentId: string,
  replyId: string
): string {
  return createHash('sha256')
    .update([
      reporterUid,
      'community_feed_comment_reply',
      communityId,
      postId,
      commentId,
      replyId,
    ].join('|'))
    .digest('hex')
    .slice(0, 48);
}

export const reportCommunityFeedCommentReply = onCall<
  CommunityFeedCommentReplyReportRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<{ reportId: string }> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const reporterUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedCommentReplyReportRequest(request.data);
    if (
      !command.communityId
      || !command.postId
      || !command.commentId
      || !command.replyId
      || !command.reason
    ) {
      throw new HttpsError('invalid-argument', 'Denúncia de resposta inválida.');
    }

    await consumeCommunityRateLimit({
      action: 'feed_report_reply',
      actorUid: reporterUid,
    });
    await assertInteractionAccess(reporterUid);

    const context = await getCommunityViewerContext(
      reporterUid,
      command.communityId
    );
    const feedContentAccess = resolveCommunityFeedContentAccess(
      context.memberContentAccess,
      context.authenticatedPreviewAccess
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
    const commentRef = postRef.collection('comments').doc(command.commentId);
    const replyRef = commentRef.collection('replies').doc(command.replyId);
    const reportId = buildReportId(
      reporterUid,
      command.communityId,
      command.postId,
      command.commentId,
      command.replyId
    );
    const reportRef = db.collection('moderation_reports').doc(reportId);

    await db.runTransaction(async (transaction) => {
      const [
        postSnapshot,
        projectionSnapshot,
        commentSnapshot,
        replySnapshot,
        reportSnapshot,
      ] = await Promise.all([
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(commentRef),
        transaction.get(replyRef),
        transaction.get(reportRef),
      ]);

      if (
        !postSnapshot.exists
        || !projectionSnapshot.exists
        || !commentSnapshot.exists
        || !replySnapshot.exists
      ) {
        throw new HttpsError('not-found', 'Resposta não encontrada.');
      }
      if (reportSnapshot.exists) {
        throw new HttpsError('already-exists', 'Você já denunciou esta resposta.');
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
      const reply = sanitizeCommunityFeedCommentReply(
        command.replyId!,
        replySnapshot.data(),
        command.commentId!
      );

      if (
        !isCommunityFeedInteractivePostKind(postKind)
        || post['status'] !== 'active'
        || post['moderationState'] !== 'active'
        || !projection
        || projection.item.kind !== postKind
        || !comment
        || !reply
        || !canViewerReadCommunityFeedAudience(projection, feedContentAccess)
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Esta resposta não está disponível para denúncia.'
        );
      }
      if (reply.actorUid === reporterUid) {
        throw new HttpsError(
          'failed-precondition',
          'Você não pode denunciar a própria resposta.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();
      transaction.create(reportRef, {
        reporterUid,
        targetType: 'community_feed_comment_reply',
        targetId: command.replyId,
        parentTargetId: command.commentId,
        grandparentTargetId: command.postId,
        containerTargetId: command.communityId,
        targetOwnerUid: null,
        targetAuthorUid: reply.actorUid,
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
