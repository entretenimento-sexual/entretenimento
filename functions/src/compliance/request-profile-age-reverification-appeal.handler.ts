// functions/src/compliance/request-profile-age-reverification-appeal.handler.ts
// -----------------------------------------------------------------------------
// REQUEST PROFILE AGE REVERIFICATION APPEAL
// -----------------------------------------------------------------------------
// Reabre o MESMO caso de reverificação após uma decisão de menoridade.
// Não cria uma fila paralela, não exige documento no pedido de contestação e
// mantém a conta restrita até nova decisão confiável da moderação.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  safeNotifyAgeReverificationRequired,
} from '../moderation/moderation-safety-notification.service';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../shared/security/callable-app-check';
import {
  writeCanonicalAgeEligibilityInTransaction,
} from './age-eligibility.service';
import {
  buildAgeReverificationDueAt,
} from './profile-age-reverification.policy';
import {
  type AgeReverificationUserDocument,
  type ModerationReportDocument,
  assertComplianceAuthenticatedUid,
  assertMinorProfileReport,
  cleanComplianceId,
  normalizeAgeReverificationStatus,
} from './profile-age-reverification.shared';

interface AgeReverificationCaseDocument {
  status?: unknown;
  result?: unknown;
  reviewedAt?: unknown;
  reviewedBy?: unknown;
  resolution?: unknown;
  evidenceMethod?: unknown;
  evidenceReferenceHash?: unknown;
  appealCount?: unknown;
}

function safeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

export const requestProfileAgeReverificationAppeal = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (
    request
  ): Promise<{
    reportId: string;
    caseId: string;
    status: 'REQUIRED';
    dueAt: number;
  }> => {
    assertCallableAppCheck(request.app);

    const uid = assertComplianceAuthenticatedUid(request.auth);

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Confirme seu e-mail antes de solicitar nova análise.'
      );
    }

    await consumeBackendRateLimitQuota({
      action: 'requestProfileAgeReverificationAppeal',
      subject: uid,
      cost: 1,
      config: {
        burstWindowMs: 60 * 60 * 1_000,
        burstMax: 1,
        sustainedWindowMs: 30 * 24 * 60 * 60 * 1_000,
        sustainedMax: 3,
      },
      message: [
        'Uma nova análise de idade já foi solicitada recentemente.',
        'Aguarde antes de enviar outra contestação.',
      ].join(' '),
    });

    const userRef = db.collection('users').doc(uid);
    const requestedAt = Date.now();
    const dueAt = buildAgeReverificationDueAt(requestedAt);

    const result = await db.runTransaction(async (transaction) => {
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

      if (
        (currentStatus !== 'REJECTED' && currentStatus !== 'EXPIRED') ||
        !caseId ||
        !reportId
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Não há revalidação encerrada disponível para nova análise.'
        );
      }

      const caseRef = db.collection('age_reverification_cases').doc(caseId);
      const reportRef = db.collection('moderation_reports').doc(reportId);
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

      const ageCase = caseSnapshot.data() as AgeReverificationCaseDocument;
      const appealCount = safeCount(ageCase.appealCount) + 1;
      const timestamp = FieldValue.serverTimestamp();
      const eligibility = writeCanonicalAgeEligibilityInTransaction(
        transaction,
        {
          uid,
          status: 'REVIEW_REQUIRED',
          source: 'AGE_REVERIFICATION',
          method: 'MANUAL_REVIEW',
          caseId,
          verifiedAtMs: null,
          decidedAtMs: requestedAt,
          expiresAtMs: null,
        }
      );

      transaction.set(
        userRef,
        {
          ageEligibility: eligibility,
          ageReverification: {
            ...ageReverification,
            status: 'REQUIRED',
            requestedAt,
            dueAt,
            submittedAt: null,
            reviewedAt: null,
            reviewedBy: null,
            result: null,
            method: null,
            declaredAgeBand: null,
            resolution: null,
            evidenceMethod: null,
            evidenceReferenceHash: null,
            appealCount,
            lastAppealedAt: requestedAt,
          },
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        caseRef,
        {
          status: 'REQUIRED',
          result: null,
          declaredAgeBand: null,
          submittedAt: null,
          requestedAt,
          dueAt,
          appealCount,
          lastAppealedAt: requestedAt,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        reportRef,
        {
          status: 'reviewing',
          moderationAction: null,
          ageReverificationStatus: 'REQUIRED',
          ageReverificationSubmittedAt: null,
          resolution: null,
          reviewedBy: null,
          reviewedAt: null,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.create(db.collection('compliance_audit').doc(), {
        uid,
        actorUid: uid,
        type: 'age_reverification.appeal_requested',
        reportId,
        caseId,
        appealCount,
        previousStatus: String(ageCase.status ?? ''),
        previousResult: String(ageCase.result ?? ''),
        previousReviewedAt: ageCase.reviewedAt ?? null,
        previousReviewedBy: ageCase.reviewedBy ?? null,
        previousResolution: ageCase.resolution ?? null,
        previousEvidenceMethod: ageCase.evidenceMethod ?? null,
        previousEvidenceReferenceHash:
          ageCase.evidenceReferenceHash ?? null,
        source: 'web',
        createdAt: timestamp,
        createdAtMs: requestedAt,
      });

      return { reportId, caseId };
    });

    await safeNotifyAgeReverificationRequired({
      reportId: result.reportId,
      caseId: result.caseId,
      targetUid: uid,
      dueAt,
    });

    return {
      ...result,
      status: 'REQUIRED',
      dueAt,
    };
  }
);
