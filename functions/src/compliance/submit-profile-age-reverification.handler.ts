import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  calculateAgeBand,
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
}

interface SubmissionTransactionResult {
  caseId: string;
  expired: boolean;
}

export const submitProfileAgeReverification = onCall<
  SubmitProfileAgeReverificationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ caseId: string; status: 'SUBMITTED' }> => {
    const uid = assertComplianceAuthenticatedUid(request.auth);

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Confirme seu e-mail antes de enviar a revalidação.'
      );
    }

    if (
      request.data?.confirmsTruthfulness !== true ||
      request.data?.acceptsRestrictedProcessing !== true
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Confirme a veracidade dos dados e o processamento restrito.'
      );
    }

    const ageBand: ProfileAgeBand | null = calculateAgeBand(
      String(request.data?.birthDate ?? '')
    );

    if (!ageBand) {
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

        if (currentStatus !== 'REQUIRED' || !caseId || !reportId) {
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
        const expired = Number.isFinite(dueAt) &&
          dueAt > 0 &&
          submittedAt > dueAt;

        if (expired) {
          transaction.set(
            userRef,
            {
              ageReverification: {
                ...ageReverification,
                status: 'EXPIRED',
                resolution: 'Prazo de envio expirado.',
              },
              updatedAt: timestamp,
            },
            { merge: true }
          );
          transaction.set(
            caseRef,
            {
              status: 'EXPIRED',
              expiredAt: submittedAt,
              updatedAt: timestamp,
            },
            { merge: true }
          );
          transaction.update(reportRef, {
            ageReverificationStatus: 'EXPIRED',
            updatedAt: timestamp,
          });
          transaction.create(auditRef, {
            uid,
            type: 'age_reverification.expired',
            reportId,
            caseId,
            source: 'system',
            createdAt: timestamp,
            createdAtMs: submittedAt,
          });

          return { caseId, expired: true };
        }

        const submissionResult = ageBand === '18_PLUS'
          ? 'INCONCLUSIVE'
          : 'UNDERAGE';

        transaction.set(
          userRef,
          {
            ageReverification: {
              ...ageReverification,
              status: 'SUBMITTED',
              submittedAt,
              result: submissionResult,
              method: 'SELF_DECLARATION_REVIEW',
              declaredAgeBand: ageBand,
              resolution: null,
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
            method: 'SELF_DECLARATION_REVIEW',
            declaredAgeBand: ageBand,
            birthDateStored: false,
            updatedAt: timestamp,
          },
          { merge: true }
        );

        transaction.update(reportRef, {
          ageReverificationStatus: 'SUBMITTED',
          ageReverificationSubmittedAt: timestamp,
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
          source: 'web',
          createdAt: timestamp,
          createdAtMs: submittedAt,
        });

        return { caseId, expired: false };
      }
    );

    if (result.expired) {
      throw new HttpsError(
        'deadline-exceeded',
        'O prazo desta revalidação expirou. Entre em contato com o suporte.'
      );
    }

    return { caseId: result.caseId, status: 'SUBMITTED' };
  }
);
