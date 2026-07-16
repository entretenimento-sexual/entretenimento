import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  buildPublicProfileSeed,
  getNicknameIndexDocId,
  normalizeNicknameForIndex,
} from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  readProfileMediaVisibilitySnapshots,
  restoreProfileMediaVisibility,
} from './profile-age-reverification-media';
import {
  type AgeReverificationUserDocument,
  type ModerationReportDocument,
  assertComplianceModerator,
  assertMinorProfileReport,
  cleanComplianceId,
  cleanComplianceText,
  normalizeAgeReverificationStatus,
  profileMinorReportDedupId,
} from './profile-age-reverification.shared';

interface ReviewProfileAgeReverificationRequest {
  reportId?: string;
  decision?: 'VERIFY' | 'REJECT';
  resolution?: string | null;
}

interface AgeReverificationCaseDocument {
  result?: string | null;
  declaredAgeBand?: string | null;
  publicProfileBackup?: Record<string, unknown> | null;
  nicknameIndexBackup?: Record<string, unknown> | null;
  nicknameIndexDocId?: string | null;
}

function cleanIndexDocumentId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 180 ||
    normalized.includes('/')
  ) {
    return '';
  }

  return normalized;
}

function asBackupRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export const reviewProfileAgeReverification = onCall<
  ReviewProfileAgeReverificationRequest
>(
  { region: FUNCTIONS_REGION },
  async (
    request
  ): Promise<{ reportId: string; status: 'VERIFIED' | 'REJECTED' }> => {
    const adminUid = await assertComplianceModerator(request.auth);
    const reportId = cleanComplianceId(request.data?.reportId);
    const decision = String(request.data?.decision ?? '')
      .trim()
      .toUpperCase();
    const resolution = cleanComplianceText(request.data?.resolution, 900);

    if (
      !reportId ||
      (decision !== 'VERIFY' && decision !== 'REJECT') ||
      resolution.length < 8
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Decisão de revalidação inválida.'
      );
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const reviewedAt = Date.now();
    const finalStatus: 'VERIFIED' | 'REJECTED' = decision === 'VERIFY'
      ? 'VERIFIED'
      : 'REJECTED';

    await db.runTransaction(async (transaction) => {
      const reportSnapshot = await transaction.get(reportRef);

      if (!reportSnapshot.exists) {
        throw new HttpsError('not-found', 'Denúncia não encontrada.');
      }

      const report = reportSnapshot.data() as ModerationReportDocument;
      const targetUid = assertMinorProfileReport(report);
      const reporterUid = cleanComplianceId(report.reporterUid);
      const caseId = cleanComplianceId(report.ageReverificationCaseId);

      if (!caseId || !reporterUid) {
        throw new HttpsError(
          'failed-precondition',
          'A denúncia não possui caso de revalidação válido.'
        );
      }

      const userRef = db.collection('users').doc(targetUid);
      const caseRef = db
        .collection('age_reverification_cases')
        .doc(caseId);
      const [userSnapshot, caseSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(caseRef),
      ]);

      if (!userSnapshot.exists || !caseSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Caso de revalidação não encontrado.'
        );
      }

      const user = userSnapshot.data() as AgeReverificationUserDocument;
      const ageCase = caseSnapshot.data() as AgeReverificationCaseDocument;
      const currentStatus = normalizeAgeReverificationStatus(
        user.ageReverification?.status
      );

      if (currentStatus !== 'SUBMITTED' && currentStatus !== 'UNDER_REVIEW') {
        throw new HttpsError(
          'failed-precondition',
          'A revalidação ainda não foi enviada para decisão.'
        );
      }

      const declaredUnderage = ageCase.result === 'UNDERAGE' ||
        ageCase.declaredAgeBand === 'UNDER_18';

      if (decision === 'VERIFY' && declaredUnderage) {
        throw new HttpsError(
          'failed-precondition',
          'Uma declaração abaixo de 18 anos não pode ser aprovada como adulta.'
        );
      }

      const accountStatus = String(user.accountStatus ?? 'active').trim();
      const canRestoreAccess = decision === 'VERIFY' &&
        accountStatus === 'active' &&
        user.suspended !== true;
      const mediaSnapshots = canRestoreAccess
        ? await readProfileMediaVisibilitySnapshots(transaction, targetUid)
        : null;
      const timestamp = FieldValue.serverTimestamp();
      const publicProfileRef = db
        .collection('public_profiles')
        .doc(targetUid);
      const fallbackIndexDocId = getNicknameIndexDocId(user);
      const backupIndexDocId = cleanIndexDocumentId(
        ageCase.nicknameIndexDocId
      );
      const nicknameIndexDocId = backupIndexDocId || fallbackIndexDocId;
      const dedupRef = db
        .collection('moderation_report_dedup')
        .doc(profileMinorReportDedupId(reporterUid, targetUid));

      if (decision === 'VERIFY') {
        transaction.set(
          userRef,
          {
            ageReverification: {
              ...user.ageReverification,
              status: 'VERIFIED',
              reviewedAt,
              reviewedBy: adminUid,
              result: 'ADULT',
              resolution,
            },
            ...(canRestoreAccess
              ? {
                  publicVisibility: 'visible',
                  interactionBlocked: false,
                  ageReverificationRestrictedAt: null,
                }
              : {}),
            updatedAt: timestamp,
          },
          { merge: true }
        );

        if (canRestoreAccess && mediaSnapshots) {
          const publicProfileBackup = asBackupRecord(
            ageCase.publicProfileBackup
          );
          const nicknameIndexBackup = asBackupRecord(
            ageCase.nicknameIndexBackup
          );

          restoreProfileMediaVisibility(
            transaction,
            mediaSnapshots,
            caseId,
            reviewedAt
          );
          transaction.set(
            publicProfileRef,
            publicProfileBackup
              ? {
                  ...publicProfileBackup,
                  uid: targetUid,
                  updatedAt: timestamp,
                }
              : buildPublicProfileSeed(user, targetUid, reviewedAt)
          );

          if (nicknameIndexDocId) {
            transaction.set(
              db.collection('public_index').doc(nicknameIndexDocId),
              nicknameIndexBackup
                ? {
                    ...nicknameIndexBackup,
                    uid: targetUid,
                    lastChangedAt: timestamp,
                  }
                : {
                    type: 'nickname',
                    value: String(user.nicknameNormalized ?? '').trim() ||
                      normalizeNicknameForIndex(user.nickname),
                    uid: targetUid,
                    createdAt: reviewedAt,
                    lastChangedAt: reviewedAt,
                  }
            );
          }
        }
      } else {
        transaction.set(
          userRef,
          {
            ageReverification: {
              ...user.ageReverification,
              status: 'REJECTED',
              reviewedAt,
              reviewedBy: adminUid,
              result: 'UNDERAGE',
              resolution,
            },
            accountStatus: 'moderation_suspended',
            publicVisibility: 'hidden',
            interactionBlocked: true,
            loginAllowed: true,
            suspended: true,
            suspensionReason: resolution,
            suspensionSource: 'moderator',
            suspendedAtMs: reviewedAt,
            suspendedBy: adminUid,
            statusUpdatedAt: reviewedAt,
            statusUpdatedBy: adminUid,
            updatedAt: timestamp,
          },
          { merge: true }
        );

        transaction.delete(publicProfileRef);

        if (nicknameIndexDocId) {
          transaction.delete(
            db.collection('public_index').doc(nicknameIndexDocId)
          );
        }
      }

      transaction.set(
        caseRef,
        {
          status: finalStatus,
          result: decision === 'VERIFY' ? 'ADULT' : 'UNDERAGE',
          reviewedAt,
          reviewedBy: adminUid,
          resolution,
          restoredMediaDocumentCount: mediaSnapshots?.totalDocuments ?? 0,
          publicProfileBackup: FieldValue.delete(),
          nicknameIndexBackup: FieldValue.delete(),
          nicknameIndexDocId: FieldValue.delete(),
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.update(reportRef, {
        status: 'resolved',
        moderationAction: decision === 'VERIFY' ? 'KEEP' : 'REMOVE',
        resolution,
        reviewedBy: adminUid,
        reviewedAt: timestamp,
        ageReverificationStatus: finalStatus,
        updatedAt: timestamp,
      });

      transaction.set(
        dedupRef,
        {
          active: false,
          reportId,
          reporterUid,
          targetUid,
          reason: 'minor_safety',
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.create(db.collection('admin_logs').doc(), {
        adminUid,
        action: 'profileAgeReverificationReviewed',
        targetUserUid: targetUid,
        details: {
          reportId,
          caseId,
          decision,
          nextStatus: finalStatus,
          restoredMediaDocumentCount: mediaSnapshots?.totalDocuments ?? 0,
          resolution,
        },
        timestamp,
      });

      transaction.create(db.collection('compliance_audit').doc(), {
        uid: targetUid,
        type: decision === 'VERIFY'
          ? 'age_reverification.verified'
          : 'age_reverification.rejected',
        reportId,
        caseId,
        actorUid: adminUid,
        result: decision === 'VERIFY' ? 'ADULT' : 'UNDERAGE',
        source: 'moderation',
        restoredMediaDocumentCount: mediaSnapshots?.totalDocuments ?? 0,
        createdAt: timestamp,
        createdAtMs: reviewedAt,
      });
    });

    return { reportId, status: finalStatus };
  }
);
