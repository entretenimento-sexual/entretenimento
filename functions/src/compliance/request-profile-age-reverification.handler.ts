import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  getNicknameIndexDocId,
} from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  hideProfileMediaVisibility,
  readProfileMediaVisibilitySnapshots,
} from './profile-age-reverification-media';
import { buildAgeReverificationDueAt } from './profile-age-reverification.policy';
import {
  type AgeReverificationUserDocument,
  type ModerationReportDocument,
  assertComplianceModerator,
  assertMinorProfileReport,
  cleanComplianceId,
  cleanComplianceText,
  isOpenReportStatus,
  normalizeAgeReverificationStatus,
} from './profile-age-reverification.shared';

interface RequestProfileAgeReverificationRequest {
  reportId?: string;
  resolution?: string | null;
}

export const requestProfileAgeReverification = onCall<
  RequestProfileAgeReverificationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ caseId: string; status: 'REQUIRED' }> => {
    const adminUid = await assertComplianceModerator(request.auth);
    const reportId = cleanComplianceId(request.data?.reportId);
    const resolution = cleanComplianceText(request.data?.resolution, 900);

    if (!reportId || resolution.length < 8) {
      throw new HttpsError(
        'invalid-argument',
        'Informe a denúncia e uma justificativa objetiva.'
      );
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const caseRef = db.collection('age_reverification_cases').doc();
    const adminLogRef = db.collection('admin_logs').doc();
    const complianceAuditRef = db.collection('compliance_audit').doc();
    const requestedAt = Date.now();
    const dueAt = buildAgeReverificationDueAt(requestedAt);

    await db.runTransaction(async (transaction) => {
      const reportSnapshot = await transaction.get(reportRef);

      if (!reportSnapshot.exists) {
        throw new HttpsError('not-found', 'Denúncia não encontrada.');
      }

      const report = reportSnapshot.data() as ModerationReportDocument;
      const targetUid = assertMinorProfileReport(report);

      if (!isOpenReportStatus(report.status)) {
        throw new HttpsError(
          'failed-precondition',
          'Esta denúncia já foi encerrada.'
        );
      }

      const userRef = db.collection('users').doc(targetUid);
      const publicProfileRef = db
        .collection('public_profiles')
        .doc(targetUid);
      const userSnapshot = await transaction.get(userRef);

      if (!userSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Usuário denunciado não encontrado.'
        );
      }

      const user = userSnapshot.data() as AgeReverificationUserDocument;
      const currentStatus = normalizeAgeReverificationStatus(
        user.ageReverification?.status
      );

      if (
        currentStatus === 'REQUIRED' ||
        currentStatus === 'SUBMITTED' ||
        currentStatus === 'UNDER_REVIEW'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este perfil já possui revalidação de idade em andamento.'
        );
      }

      const accountStatus = String(user.accountStatus ?? 'active')
        .trim()
        .toLowerCase();
      const publicVisibility = String(user.publicVisibility ?? 'visible')
        .trim()
        .toLowerCase();

      if (
        accountStatus !== 'active' ||
        user.suspended === true ||
        user.interactionBlocked === true ||
        publicVisibility !== 'visible'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'O perfil já possui outra restrição ativa e não pode iniciar esta ' +
            'revalidação automaticamente.'
        );
      }

      const nicknameIndexDocId = getNicknameIndexDocId(user);
      const nicknameIndexRef = nicknameIndexDocId
        ? db.collection('public_index').doc(nicknameIndexDocId)
        : null;
      const publicProfileSnapshot = await transaction.get(publicProfileRef);
      const nicknameIndexSnapshot = nicknameIndexRef
        ? await transaction.get(nicknameIndexRef)
        : null;

      if (!publicProfileSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'O perfil já não está disponível publicamente.'
        );
      }

      const mediaSnapshots = await readProfileMediaVisibilitySnapshots(
        transaction,
        targetUid
      );
      const timestamp = FieldValue.serverTimestamp();

      hideProfileMediaVisibility(
        transaction,
        mediaSnapshots,
        caseRef.id,
        requestedAt
      );

      transaction.set(
        userRef,
        {
          ageReverification: {
            status: 'REQUIRED',
            caseId: caseRef.id,
            reportId,
            source: 'MINOR_SAFETY_PROFILE_REPORT',
            requestedAt,
            dueAt,
            submittedAt: null,
            reviewedAt: null,
            reviewedBy: null,
            result: null,
            method: null,
            resolution: null,
          },
          publicVisibility: 'hidden',
          interactionBlocked: true,
          ageReverificationRestrictedAt: requestedAt,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.delete(publicProfileRef);

      if (nicknameIndexRef) {
        transaction.delete(nicknameIndexRef);
      }

      transaction.create(caseRef, {
        caseId: caseRef.id,
        reportId,
        targetUid,
        status: 'REQUIRED',
        source: 'MINOR_SAFETY_PROFILE_REPORT',
        requestedAt,
        dueAt,
        requestedBy: adminUid,
        hiddenMediaDocumentCount: mediaSnapshots.totalDocuments,
        publicProfileBackup: publicProfileSnapshot.data(),
        nicknameIndexBackup: nicknameIndexSnapshot?.exists
          ? nicknameIndexSnapshot.data()
          : null,
        nicknameIndexDocId: nicknameIndexDocId || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.update(reportRef, {
        status: 'reviewing',
        resolution,
        reviewedBy: adminUid,
        reviewedAt: timestamp,
        ageReverificationCaseId: caseRef.id,
        ageReverificationStatus: 'REQUIRED',
        updatedAt: timestamp,
      });

      transaction.create(adminLogRef, {
        adminUid,
        action: 'profileAgeReverificationRequested',
        targetUserUid: targetUid,
        details: {
          reportId,
          caseId: caseRef.id,
          reason: 'minor_safety',
          targetType: 'profile',
          hiddenMediaDocumentCount: mediaSnapshots.totalDocuments,
          resolution,
        },
        timestamp,
      });

      transaction.create(complianceAuditRef, {
        uid: targetUid,
        type: 'age_reverification.required',
        reportId,
        caseId: caseRef.id,
        actorUid: adminUid,
        source: 'moderation',
        hiddenMediaDocumentCount: mediaSnapshots.totalDocuments,
        createdAt: timestamp,
        createdAtMs: requestedAt,
      });
    });

    return { caseId: caseRef.id, status: 'REQUIRED' };
  }
);
