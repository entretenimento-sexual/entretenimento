import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  PROFILE_AGE_REVERIFICATION_RESPONSE_WINDOW_BASIS,
  calculateAgeBand,
  isAgeReverificationSubmissionAcceptedStatus,
  type ProfileAgeBand,
} from './profile-age-reverification.policy';
import {
  type AgeReverificationUserDocument,
  type ModerationReportDocument,
  assertComplianceAuthenticatedUid,
  assertMinorProfileReport,
  cleanComplianceId,
  normalizeAgeReverificationStatus,
} from './profile-age-reverification.shared';

interface SubmitProfileAgeReverificationRequest {
  birthDate?: string;
  confirmsTruthfulness?: boolean;
  acceptsRestrictedProcessing?: boolean;
  requestsAlternativeReview?: boolean;
}

interface SubmissionTransactionResult {
  caseId: string;
  submittedAfterOperationalTarget: boolean;
  alternativeReviewRequested: boolean;
}

export const submitProfileAgeReverification = onCall<
  SubmitProfileAgeReverificationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    caseId: string;
    status: 'SUBMITTED';
    submittedAfterOperationalTarget: boolean;
    alternativeReviewRequested: boolean;
  }> => {
    const uid = assertComplianceAuthenticatedUid(request.auth);

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Confirme seu e-mail antes de enviar a revalidação.'
      );
    }

    const alternativeReviewRequested =
      request.data?.requestsAlternativeReview === true;

    if (request.data?.acceptsRestrictedProcessing !== true) {
      throw new HttpsError(
        'invalid-argument',
        'Confirme a ciência sobre o processamento restrito.'
      );
    }

    if (
      !alternativeReviewRequested &&
      request.data?.confirmsTruthfulness !== true
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Confirme a veracidade dos dados informados.'
      );
    }

    const ageBand: ProfileAgeBand | null = alternativeReviewRequested
      ? null
      : calculateAgeBand(String(request.data?.birthDate ?? ''));

    if (!alternativeReviewRequested && !ageBand) {
      throw new HttpsError(
        'invalid-argument',
        'Data de nascimento inválida.'
      );
    }

    const userRef = db.collection('users').doc(uid);
    const submittedAt = Date.now();

    const result = await db.runTransaction<SubmissionTransactionResult>(
      async (transaction) => {
        const userSnapshot = await transaction.get(userRef);

        if (!userSnapshot.exists) {
          throw new HttpsError('not-found', 'Conta não encontrada.');
        }

        const user = userSnapshot.data() as AgeReverificationUserDocument;
        const ageReverification = user.ageReverification ?? {};
        const currentStatus = normalizeAgeReverificationStatus(
          ageReverification.status
        );
        const caseId = cleanComplianceId(ageReverification.caseId);
        const reportId = cleanComplianceId(ageReverification.reportId);
        const dueAt = Number(ageReverification.dueAt ?? 0);

        if (
          !isAgeReverificationSubmissionAcceptedStatus(currentStatus) ||
          !caseId ||
          !reportId
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Não há revalidação de idade pendente para esta conta.'
          );
        }

        const caseRef = db
          .collection('age_reverification_cases')
          .doc(caseId);
        const reportRef = db
          .collection('moderation_reports')
          .doc(reportId);
        const auditRef = db.collection('compliance_audit').doc();
        const [caseSnapshot, reportSnapshot] = await Promise.all([
          transaction.get(caseRef),
          transaction.get(reportRef),
        ]);

        if (!caseSnapshot.exists || !reportSnapshot.exists) {
          throw new HttpsError(
            'failed-precondition',
            'O caso de revalidação não está disponível.'
          );
        }

        const report = reportSnapshot.data() as ModerationReportDocument;

        if (assertMinorProfileReport(report) !== uid) {
          throw new HttpsError(
            'permission-denied',
            'Caso de revalidação inválido.'
          );
        }

        const timestamp = FieldValue.serverTimestamp();
        const submittedAfterOperationalTarget =
          Number.isFinite(dueAt) &&
          dueAt > 0 &&
          submittedAt > dueAt;
        const submissionResult = alternativeReviewRequested
          ? 'INCONCLUSIVE'
          : ageBand === '18_PLUS'
            ? 'INCONCLUSIVE'
            : 'UNDERAGE';
        const submissionMethod = alternativeReviewRequested
          ? 'ALTERNATIVE_TRUSTED_REVIEW_REQUEST'
          : 'SELF_DECLARATION_REVIEW';

        transaction.set(
          userRef,
          {
            ageReverification: {
              ...ageReverification,
              status: 'SUBMITTED',
              submittedAt,
              result: submissionResult,
              method: submissionMethod,
              declaredAgeBand: ageBand,
              resolution: null,
              submittedAfterOperationalTarget,
              alternativeReviewRequested,
              responseWindowBasis:
                PROFILE_AGE_REVERIFICATION_RESPONSE_WINDOW_BASIS,
            },
            updatedAt: timestamp,
          },
          { merge: true }
        );

        transaction.set(
          caseRef,
          {
            status: 'SUBMITTED',
            submittedAt,
            result: submissionResult,
            method: submissionMethod,
            declaredAgeBand: ageBand,
            birthDateStored: false,
            submittedAfterOperationalTarget,
            alternativeReviewRequested,
            responseWindowBasis:
              PROFILE_AGE_REVERIFICATION_RESPONSE_WINDOW_BASIS,
            updatedAt: timestamp,
          },
          { merge: true }
        );

        transaction.update(reportRef, {
          ageReverificationStatus: 'SUBMITTED',
          ageReverificationSubmittedAt: timestamp,
          ageReverificationSubmittedAfterOperationalTarget:
            submittedAfterOperationalTarget,
          ageReverificationAlternativeReviewRequested:
            alternativeReviewRequested,
          updatedAt: timestamp,
        });

        transaction.create(auditRef, {
          uid,
          type: 'age_reverification.submitted',
          reportId,
          caseId,
          result: submissionResult,
          declaredAgeBand: ageBand,
          birthDateStored: false,
          dueAt: Number.isFinite(dueAt) && dueAt > 0 ? dueAt : null,
          submittedAfterOperationalTarget,
          alternativeReviewRequested,
          responseWindowBasis:
            PROFILE_AGE_REVERIFICATION_RESPONSE_WINDOW_BASIS,
          source: 'web',
          createdAt: timestamp,
          createdAtMs: submittedAt,
        });

        return {
          caseId,
          submittedAfterOperationalTarget,
          alternativeReviewRequested,
        };
      }
    );

    return {
      caseId: result.caseId,
      status: 'SUBMITTED',
      submittedAfterOperationalTarget:
        result.submittedAfterOperationalTarget,
      alternativeReviewRequested: result.alternativeReviewRequested,
    };
  }
);
