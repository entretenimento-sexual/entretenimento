import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';

const MEDIA_CONTEST_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 4,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 12,
});

interface SubmitMediaModerationContestRequest {
  reportId?: string;
  statement?: string | null;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanStatement(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

export const submitMediaModerationContest =
onCall<SubmitMediaModerationContestRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

    const ownerUid = cleanId(request.auth?.uid);
    const reportId = cleanId(request.data?.reportId);
    const statement = cleanStatement(request.data?.statement);

    if (!ownerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!reportId || !statement) {
      throw new HttpsError(
        'invalid-argument',
        'Informe a denúncia e uma contestação válida.'
      );
    }

    await consumeBackendRateLimitQuota({
      action: 'media-moderation-contest-submit',
      subject: ownerUid,
      config: MEDIA_CONTEST_RATE_LIMIT,
      message: 'Muitas contestações foram enviadas em pouco tempo.',
    });

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const contestRef = db.collection('moderation_content_contests').doc(reportId);

    await db.runTransaction(async (transaction) => {
      const [reportSnap, contestSnap] = await Promise.all([
        transaction.get(reportRef),
        transaction.get(contestRef),
      ]);

      if (!reportSnap.exists) {
        throw new HttpsError('not-found', 'Caso de moderação não encontrado.');
      }

      if (contestSnap.exists) {
        throw new HttpsError(
          'already-exists',
          'Este caso já possui uma contestação registrada.'
        );
      }

      const report = reportSnap.data() ?? {};
      const targetType = String(report['targetType'] ?? '').trim();
      const targetOwnerUid = cleanId(report['targetOwnerUid']);
      const status = String(report['status'] ?? '').trim().toLowerCase();

      if (!['photo', 'video'].includes(targetType)) {
        throw new HttpsError(
          'failed-precondition',
          'Este fluxo aceita apenas contestação de Foto ou Vídeo.'
        );
      }

      if (targetOwnerUid !== ownerUid) {
        throw new HttpsError(
          'permission-denied',
          'Você não pode contestar este caso.'
        );
      }

      if (!['open', 'reviewing', 'resolved'].includes(status)) {
        throw new HttpsError(
          'failed-precondition',
          'Este caso não aceita contestação.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();

      transaction.create(contestRef, {
        reportId,
        ownerUid,
        targetType,
        targetId: String(report['targetId'] ?? '').trim() || null,
        statement,
        status: 'SUBMITTED',
        reviewStatus: 'PENDING',
        autoRestoreAllowed: false,
        evidenceReleaseAllowed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.set(
        reportRef,
        {
          ownerContestStatus: 'SUBMITTED',
          ownerContestReviewStatus: 'PENDING',
          ownerContestSubmittedAt: timestamp,
          ownerContestUpdatedAt: timestamp,
        },
        { merge: true }
      );
    });

    return {
      reportId,
      contestStatus: 'SUBMITTED' as const,
      reviewStatus: 'PENDING' as const,
      contentRestored: false,
      evidenceReleased: false,
    };
  }
);
