import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import { db, FieldValue } from '../../firebaseApp';
import {
  safeRecordModerationReviewSignal,
} from '../../moderation/moderation-automation.service';
import {
  safeRecordModerationReporterOutcome,
} from '../../moderation/moderation-reporter-abuse.service';
import {
  isCriticalMinorMediaSafetyReason,
  type MediaReportSafetyReason,
} from './media-report-safety';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';

type ContestDecision = 'UPHOLD' | 'OVERTURN';

interface ReviewMediaModerationContestRequest {
  reportId?: string;
  decision?: ContestDecision;
  resolution?: string | null;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanDecision(value: unknown): ContestDecision | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'UPHOLD' || normalized === 'OVERTURN'
    ? normalized
    : null;
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

const MEDIA_CONTEST_REVIEW_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 20,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 120,
});

function assertAdmin(requestAuth: unknown): string {
  const authData = requestAuth as {
    uid?: unknown;
    token?: unknown;
  } | null | undefined;
  const adminUid = cleanId(authData?.uid);
  const token = typeof authData?.token === 'object' && authData.token !== null
    ? authData.token as Record<string, unknown>
    : {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const allowed = token['admin'] === true ||
    token['role'] === 'admin' ||
    roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (!allowed) {
    throw new HttpsError('permission-denied', 'Permissão administrativa necessária.');
  }

  return adminUid;
}

export const reviewMediaModerationContest =
onCall<ReviewMediaModerationContestRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

    const adminUid = assertAdmin(request.auth);

    await consumeBackendRateLimitQuota({
      action: 'media-contest-review',
      subject: adminUid,
      config: MEDIA_CONTEST_REVIEW_RATE_LIMIT,
      message: 'Muitas revisões de contestação foram solicitadas em pouco tempo.',
    });
    const reportId = cleanId(request.data?.reportId);
    const decision = cleanDecision(request.data?.decision);
    const resolution = cleanText(request.data?.resolution);

    if (!reportId || !decision || !resolution) {
      throw new HttpsError(
        'invalid-argument',
        'Informe caso, decisão e fundamentação.'
      );
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const contestRef = db.collection('moderation_content_contests').doc(reportId);
    const adminLogRef = db.collection('admin_logs').doc();

    const result = await db.runTransaction(async (transaction) => {
      const [reportSnap, contestSnap] = await Promise.all([
        transaction.get(reportRef),
        transaction.get(contestRef),
      ]);

      if (!reportSnap.exists || !contestSnap.exists) {
        throw new HttpsError('not-found', 'Contestação não encontrada.');
      }

      const report = reportSnap.data() ?? {};
      const contest = contestSnap.data() ?? {};
      const reviewStatus = String(contest['reviewStatus'] ?? '').trim().toUpperCase();

      if (reviewStatus !== 'PENDING') {
        throw new HttpsError(
          'failed-precondition',
          'Esta contestação já foi analisada.'
        );
      }

      const targetType = String(report['targetType'] ?? '').trim();
      if (!['photo', 'video'].includes(targetType)) {
        throw new HttpsError(
          'failed-precondition',
          'Contestação não pertence a Foto/Vídeo.'
        );
      }

      const ownerUid = cleanId(report['targetOwnerUid']);
      const reporterUid = cleanId(report['reporterUid']);
      const reason = String(report['reviewSafetyReason'] ?? report['reason'] ?? '')
        .trim()
        .toLowerCase() as MediaReportSafetyReason;
      const timestamp = FieldValue.serverTimestamp();
      const overturned = decision === 'OVERTURN';

      transaction.set(
        contestRef,
        {
          status: 'RESOLVED',
          reviewStatus: overturned ? 'OVERTURNED' : 'UPHELD',
          decision,
          resolution,
          reviewedBy: adminUid,
          reviewedAt: timestamp,
          updatedAt: timestamp,
          autoRestoreApplied: false,
          evidenceReleased: false,
        },
        { merge: true }
      );

      transaction.set(
        reportRef,
        {
          ownerContestStatus: 'RESOLVED',
          ownerContestReviewStatus: overturned ? 'OVERTURNED' : 'UPHELD',
          ownerContestDecision: decision,
          ownerContestResolution: resolution,
          ownerContestReviewedBy: adminUid,
          ownerContestReviewedAt: timestamp,
          ownerContestUpdatedAt: timestamp,
          ...(overturned
            ? {
              effectiveModerationAction: 'KEEP',
              confirmedViolationEffective: false,
              accountRemediationReviewRequired: true,
            }
            : {
              effectiveModerationAction:
                String(report['moderationAction'] ?? '').trim().toUpperCase() || null,
              confirmedViolationEffective:
                String(report['moderationAction'] ?? '').trim().toUpperCase() === 'REMOVE',
              accountRemediationReviewRequired: false,
            }),
        },
        { merge: true }
      );

      transaction.set(adminLogRef, {
        adminUid,
        action: 'mediaModerationContestReview',
        targetUserUid: ownerUid || null,
        details: {
          reportId,
          targetType,
          decision,
          resolution,
          autoRestoreApplied: false,
          evidenceReleased: false,
        },
        timestamp,
      });

      return {
        ownerUid,
        reporterUid,
        reason,
        overturned,
      };
    });

    if (result.overturned && result.ownerUid) {
      await safeRecordModerationReviewSignal({
        reportId,
        targetUid: result.ownerUid,
        critical: isCriticalMinorMediaSafetyReason(result.reason),
        confirmed: false,
      });

      if (result.reporterUid) {
        await safeRecordModerationReporterOutcome({
          reporterUid: result.reporterUid,
          reportId,
          confirmed: false,
        });
      }
    }

    return {
      reportId,
      decision,
      reviewStatus: result.overturned ? 'OVERTURNED' as const : 'UPHELD' as const,
      contentRestored: false,
      evidenceReleased: false,
    };
  }
);
