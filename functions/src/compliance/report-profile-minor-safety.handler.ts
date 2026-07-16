import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  type AgeReverificationUserDocument,
  assertComplianceAuthenticatedUid,
  cleanComplianceId,
  cleanComplianceRoute,
  cleanComplianceText,
  profileMinorReportDedupId,
} from './profile-age-reverification.shared';

interface ReportProfileMinorSafetyRequest {
  targetUid?: string;
  details?: string | null;
  route?: string | null;
}

export const reportProfileMinorSafety = onCall<ReportProfileMinorSafetyRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ reportId: string }> => {
    const reporterUid = assertComplianceAuthenticatedUid(request.auth);
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

    const reportRef = db.collection('moderation_reports').doc();
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
    });

    return { reportId: reportRef.id };
  }
);
