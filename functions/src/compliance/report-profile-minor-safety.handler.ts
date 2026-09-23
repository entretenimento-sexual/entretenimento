import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  safeRecordModerationOpenSignal,
} from '../moderation/moderation-automation.service';
import {
  getModerationReporterAbuseRisk,
} from '../moderation/moderation-reporter-abuse.service';
import {
  moderationReportRateLimitCost,
} from '../moderation/moderation-reporter-abuse.policy';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';
import {
  safeNotifyModerationReportOpened,
} from '../moderation/moderation-safety-notification.service';
import {
  type AgeReverificationUserDocument,
  assertComplianceAuthenticatedUid,
  cleanComplianceId,
  cleanComplianceRoute,
  cleanComplianceText,
  profileMinorReportDedupId,
} from './profile-age-reverification.shared';

const PROFILE_MINOR_REPORT_RATE_LIMIT = Object.freeze({
  burstWindowMs: 10 * 60 * 1_000,
  burstMax: 3,
  sustainedWindowMs: 24 * 60 * 60 * 1_000,
  sustainedMax: 12,
});

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

interface ReportProfileMinorSafetyRequest {
  targetUid?: string;
  details?: string | null;
  route?: string | null;
}

export const reportProfileMinorSafety = onCall<ReportProfileMinorSafetyRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request): Promise<{ reportId: string }> => {
    const reporterUid = assertComplianceAuthenticatedUid(request.auth);
    const reporterAbuseRisk = await getModerationReporterAbuseRisk(
      reporterUid
    );

    await consumeBackendRateLimitQuota({
      action: 'moderation:report-profile-minor-safety',
      subject: reporterUid,
      cost: moderationReportRateLimitCost(reporterAbuseRisk),
      config: PROFILE_MINOR_REPORT_RATE_LIMIT,
      message:
        'Muitas denúncias foram enviadas em pouco tempo. Tente novamente mais tarde.',
    });
    const targetUid = cleanComplianceId(request.data?.targetUid);
    const details = cleanComplianceText(request.data?.details, 1200);
    const route = cleanComplianceRoute(request.data?.route);

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'Perfil denunciado inválido.');
    }

    if (targetUid === reporterUid) {
      throw new HttpsError(
        'failed-precondition',
        'Não é possível denunciar o próprio perfil.'
      );
    }

    const receivedAt = Date.now();
    const reportRef = db.collection('moderation_reports').doc();
    const auditRef = db.collection('compliance_audit').doc();
    const dedupRef = db
      .collection('moderation_report_dedup')
      .doc(profileMinorReportDedupId(reporterUid, targetUid));
    const targetUserRef = db.collection('users').doc(targetUid);

    await db.runTransaction(async (transaction) => {
      const [targetUserSnapshot, dedupSnapshot] = await Promise.all([
        transaction.get(targetUserRef),
        transaction.get(dedupRef),
      ]);

      if (!targetUserSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Perfil denunciado não encontrado.'
        );
      }

      const targetUser = targetUserSnapshot.data() as
        AgeReverificationUserDocument;
      const accountStatus = String(
        targetUser.accountStatus ?? 'active'
      ).trim();

      if (accountStatus === 'deleted') {
        throw new HttpsError(
          'not-found',
          'Perfil denunciado não encontrado.'
        );
      }

      const dedup = dedupSnapshot.data() ?? {};

      if (dedup['active'] === true) {
        throw new HttpsError(
          'already-exists',
          'Você já possui uma denúncia de possível menoridade em análise para este perfil.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();

      transaction.create(reportRef, {
        reporterUid,
        targetType: 'profile',
        targetId: targetUid,
        parentTargetId: null,
        targetOwnerUid: targetUid,
        targetAuthorUid: targetUid,
        reason: 'minor_safety',
        details: details || null,
        route,
        status: 'open',
        moderationAction: null,
        ageReverificationCaseId: null,
        ageReverificationStatus: null,
        source: 'web',
        reporterAbuseRisk,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.set(dedupRef, {
        active: true,
        reportId: reportRef.id,
        reporterUid,
        targetUid,
        reason: 'minor_safety',
        updatedAt: timestamp,
      });

      transaction.create(auditRef, {
        uid: targetUid,
        type: 'minor_safety.profile_report.received',
        reportId: reportRef.id,
        reporterUid,
        source: 'web',
        presumption: 'SUSPECTED_NOT_CONFIRMED',
        legalClassification: 'NOT_DETERMINED',
        reporterAbuseRisk,
        createdAt: timestamp,
        createdAtMs: receivedAt,
      });
    });

    await safeRecordModerationOpenSignal({
      reportId: reportRef.id,
      targetUid,
      reporterUid,
      targetKey: `profile:${targetUid}`,
      critical: true,
      quarantined: false,
      allowReversibleEnforcement: true,
    });

    await safeNotifyModerationReportOpened(reportRef.id);

    return { reportId: reportRef.id };
  }
);
