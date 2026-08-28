import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertStaffAuthorization } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { isProfileMinorSafetyReport } from './profile-age-reverification.policy';

interface ReviewProfileMinorSafetyReportRequest {
  reportId?: string;
  resolution?: string | null;
}

interface ModerationReportDocument {
  reporterUid?: string;
  targetType?: string;
  targetId?: string;
  targetOwnerUid?: string;
  reason?: string;
  status?: string;
  ageReverificationCaseId?: string | null;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanResolution(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
}

function activeDedupId(reporterUid: string, targetUid: string): string {
  return `profile_minor_${createHash('sha256')
    .update(`${reporterUid}:${targetUid}`)
    .digest('hex')}`;
}

export const reviewProfileMinorSafetyReport = onCall<
  ReviewProfileMinorSafetyReportRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ reportId: string; status: 'rejected' }> => {
    const adminUid = cleanId(request.auth?.uid);

    await assertStaffAuthorization({
      actorUid: adminUid || null,
      authToken: (request.auth?.token ?? {}) as Record<string, unknown>,
      requiredPermission: 'users:suspend',
    });

    const reportId = cleanId(request.data?.reportId);
    const resolution = cleanResolution(request.data?.resolution);

    if (!reportId || resolution.length < 8) {
      throw new HttpsError(
        'invalid-argument',
        'Informe a denúncia e uma justificativa objetiva.'
      );
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);

    await db.runTransaction(async (transaction) => {
      const reportSnapshot = await transaction.get(reportRef);

      if (!reportSnapshot.exists) {
        throw new HttpsError('not-found', 'Denúncia não encontrada.');
      }

      const report = reportSnapshot.data() as ModerationReportDocument;
      const status = String(report.status ?? '').trim().toLowerCase();
      const targetUid = cleanId(report.targetOwnerUid) || cleanId(report.targetId);
      const reporterUid = cleanId(report.reporterUid);

      if (!isProfileMinorSafetyReport(report) || !targetUid || !reporterUid) {
        throw new HttpsError(
          'failed-precondition',
          'Esta decisão é exclusiva para denúncia de perfil por possível menoridade.'
        );
      }

      if (status !== 'open' && status !== 'reviewing') {
        throw new HttpsError(
          'failed-precondition',
          'Esta denúncia já foi encerrada.'
        );
      }

      if (cleanId(report.ageReverificationCaseId)) {
        throw new HttpsError(
          'failed-precondition',
          'A denúncia já originou uma revalidação de idade.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();
      const dedupRef = db
        .collection('moderation_report_dedup')
        .doc(activeDedupId(reporterUid, targetUid));

      transaction.update(reportRef, {
        status: 'rejected',
        moderationAction: 'KEEP',
        resolution,
        reviewedBy: adminUid,
        reviewedAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.set(dedupRef, {
        active: false,
        reportId,
        reporterUid,
        targetUid,
        reason: 'minor_safety',
        updatedAt: timestamp,
      }, { merge: true });

      transaction.create(db.collection('admin_logs').doc(), {
        adminUid,
        action: 'profileMinorSafetyReportRejected',
        targetUserUid: targetUid,
        details: {
          reportId,
          previousStatus: status,
          nextStatus: 'rejected',
          reason: 'minor_safety',
          targetType: 'profile',
          resolution,
        },
        timestamp,
      });
    });

    return { reportId, status: 'rejected' };
  }
);
