// functions/src/compliance/review-initial-age-verification.handler.ts
// -----------------------------------------------------------------------------
// REVIEW INITIAL AGE VERIFICATION
// -----------------------------------------------------------------------------
// Resolve a solicitação inicial/contestação somente a partir de decisão de
// staff autorizada e evidência confiável referenciada. A referência bruta é
// convertida em hash antes de qualquer persistência.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  safeNotifyInitialAgeEligibilityOutcome,
} from '../moderation/moderation-safety-notification.service';
import {
  normalizeAgeReviewEvidence,
  type AgeReviewEvidenceMethod,
} from './age-review-evidence.policy';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  writeCanonicalAgeEligibilityInTransaction,
} from './age-eligibility.service';
import {
  assertComplianceModerator,
  cleanComplianceId,
  cleanComplianceText,
} from './profile-age-reverification.shared';

interface ReviewInitialAgeVerificationRequest {
  reportId?: string;
  decision?: 'VERIFY' | 'REJECT';
  resolution?: string | null;
  evidenceMethod?: AgeReviewEvidenceMethod;
  evidenceReference?: string | null;
}

export const reviewInitialAgeVerification = onCall<
  ReviewInitialAgeVerificationRequest
>(
  { region: FUNCTIONS_REGION },
  async (
    request
  ): Promise<{
    reportId: string;
    status: 'VERIFIED_ADULT' | 'DENIED_UNDERAGE';
  }> => {
    const adminUid = await assertComplianceModerator(request.auth);
    const reportId = cleanComplianceId(request.data?.reportId);
    const decision = String(request.data?.decision ?? '')
      .trim()
      .toUpperCase();
    const resolution = cleanComplianceText(request.data?.resolution, 900);
    const evidence = normalizeAgeReviewEvidence({
      method: request.data?.evidenceMethod,
      reference: request.data?.evidenceReference,
    });

    if (
      !reportId ||
      (decision !== 'VERIFY' && decision !== 'REJECT') ||
      resolution.length < 8 ||
      !evidence
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Decisão etária exige justificativa e evidência confiável.'
      );
    }

    const reviewedAt = Date.now();
    const finalStatus = decision === 'VERIFY'
      ? 'VERIFIED_ADULT' as const
      : 'DENIED_UNDERAGE' as const;
    const reportRef = db.collection('moderation_reports').doc(reportId);

    const targetUid = await db.runTransaction(async (transaction) => {
      const reportSnapshot = await transaction.get(reportRef);

      if (!reportSnapshot.exists) {
        throw new HttpsError('not-found', 'Solicitação não encontrada.');
      }

      const report = reportSnapshot.data() ?? {};
      const targetUid =
        cleanComplianceId(report['targetOwnerUid']) ||
        cleanComplianceId(report['targetId']);
      const reportReason = String(report['reason'] ?? '').trim();
      const reportStatus = String(report['status'] ?? '').trim().toLowerCase();

      if (
        !targetUid ||
        report['targetType'] !== 'profile' ||
        reportReason !== 'age_verification_request' ||
        (reportStatus !== 'open' && reportStatus !== 'reviewing')
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A solicitação de verificação não está aberta para decisão.'
        );
      }

      const userRef = db.collection('users').doc(targetUid);
      const eligibilityRef = db
        .collection('age_eligibility_records')
        .doc(targetUid);
      const [userSnapshot, eligibilitySnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(eligibilityRef),
      ]);

      if (!userSnapshot.exists) {
        throw new HttpsError('not-found', 'Conta não encontrada.');
      }

      const current = evaluateCanonicalAgeEligibility({
        uid: targetUid,
        rawRecord: eligibilitySnapshot.exists
          ? eligibilitySnapshot.data()
          : null,
        nowMs: reviewedAt,
      });

      if (
        current.status !== 'REVIEW_REQUIRED' ||
        current.caseId !== reportId
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A autoridade etária já mudou; atualize a fila antes de decidir.'
        );
      }

      const projection = writeCanonicalAgeEligibilityInTransaction(
        transaction,
        {
          uid: targetUid,
          status: finalStatus,
          source: 'INITIAL_VERIFICATION',
          method: 'MANUAL_REVIEW',
          caseId: reportId,
          verifiedAtMs: decision === 'VERIFY' ? reviewedAt : null,
          decidedAtMs: reviewedAt,
          expiresAtMs: null,
        }
      );
      const timestamp = FieldValue.serverTimestamp();

      transaction.set(
        userRef,
        {
          ageEligibility: projection,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        reportRef,
        {
          status: 'resolved',
          ageVerificationReviewStatus: finalStatus,
          evidenceMethod: evidence.method,
          evidenceReferenceHash: evidence.referenceHash,
          resolution,
          reviewedBy: adminUid,
          reviewedAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.create(db.collection('admin_logs').doc(), {
        adminUid,
        action: 'initialAgeVerificationReviewed',
        targetUserUid: targetUid,
        details: {
          reportId,
          decision,
          nextStatus: finalStatus,
          evidenceMethod: evidence.method,
          evidenceReferenceHash: evidence.referenceHash,
          resolution,
        },
        timestamp,
      });

      transaction.create(db.collection('compliance_audit').doc(), {
        uid: targetUid,
        type: decision === 'VERIFY'
          ? 'age_eligibility.initial_review_verified'
          : 'age_eligibility.initial_review_denied',
        reportId,
        actorUid: adminUid,
        result: decision === 'VERIFY' ? 'ADULT' : 'UNDERAGE',
        evidenceMethod: evidence.method,
        evidenceReferenceHash: evidence.referenceHash,
        source: 'moderation',
        createdAt: timestamp,
        createdAtMs: reviewedAt,
      });

      return targetUid;
    });

    await safeNotifyInitialAgeEligibilityOutcome({
      assertionId: reportId,
      uid: targetUid,
      status: finalStatus,
    });

    return {
      reportId,
      status: finalStatus,
    };
  }
);
