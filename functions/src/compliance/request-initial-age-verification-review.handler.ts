// functions/src/compliance/request-initial-age-verification-review.handler.ts
// -----------------------------------------------------------------------------
// REQUEST INITIAL AGE VERIFICATION REVIEW
// -----------------------------------------------------------------------------
// Abre/reabre um caso backend de verificação etária sem aceitar qualquer prova
// client-side. O caso permanece REVIEW_REQUIRED até uma decisão administrativa
// baseada em evidência confiável ou até uma assertion de provedor resolver a
// autoridade canônica.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';
import {
  safeNotifyInitialAgeEligibilityOutcome,
} from '../moderation/moderation-safety-notification.service';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  writeCanonicalAgeEligibilityInTransaction,
} from './age-eligibility.service';
import {
  assertComplianceAuthenticatedUid,
} from './profile-age-reverification.shared';

const INITIAL_AGE_REVIEW_RATE_LIMIT = Object.freeze({
  burstWindowMs: 10 * 60 * 1_000,
  burstMax: 5,
  sustainedWindowMs: 24 * 60 * 60 * 1_000,
  sustainedMax: 20,
});

interface RequestInitialAgeVerificationReviewResponse {
  reportId: string | null;
  status: 'VERIFIED_ADULT' | 'REVIEW_REQUIRED';
}

function initialAgeReportId(uid: string): string {
  const digest = createHash('sha256')
    .update(uid)
    .digest('hex')
    .slice(0, 40);

  return `age_initial_${digest}`;
}


export const requestInitialAgeVerificationReview = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (
    request
  ): Promise<RequestInitialAgeVerificationReviewResponse> => {
    assertCallableAppCheck(request.app);

    const uid = assertComplianceAuthenticatedUid(request.auth);

    const nowMs = Date.now();

    await consumeBackendRateLimitQuota({
      action: 'compliance:initial-age-verification-review',
      subject: uid,
      config: INITIAL_AGE_REVIEW_RATE_LIMIT,
      message:
        'Muitas solicitações de verificação foram feitas em pouco tempo. Tente novamente mais tarde.',
      now: nowMs,
    });

    const reportId = initialAgeReportId(uid);
    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const eligibilityRef = db.collection('age_eligibility_records').doc(uid);
      const reportRef = db.collection('moderation_reports').doc(reportId);
      const [userSnapshot, eligibilitySnapshot, reportSnapshot] =
        await Promise.all([
          transaction.get(userRef),
          transaction.get(eligibilityRef),
          transaction.get(reportRef),
        ]);

      if (!userSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Recupere os dados da sua conta antes de verificar a maioridade.'
        );
      }

      const current = evaluateCanonicalAgeEligibility({
        uid,
        rawRecord: eligibilitySnapshot.exists
          ? eligibilitySnapshot.data()
          : null,
        nowMs,
      });

      if (current.allowed) {
        return {
          reportId: null,
          status: 'VERIFIED_ADULT' as const,
          notify: false,
        };
      }

      const existingReportStatus = String(
        reportSnapshot.data()?.['status'] ?? ''
      ).trim().toLowerCase();

      if (
        current.status === 'REVIEW_REQUIRED' &&
        current.caseId === reportId &&
        (existingReportStatus === 'open' ||
          existingReportStatus === 'reviewing')
      ) {
        return {
          reportId,
          status: 'REVIEW_REQUIRED' as const,
          notify: false,
        };
      }

      const projection = writeCanonicalAgeEligibilityInTransaction(
        transaction,
        {
          uid,
          status: 'REVIEW_REQUIRED',
          source: 'INITIAL_VERIFICATION',
          method: 'MANUAL_REVIEW',
          caseId: reportId,
          verifiedAtMs: null,
          decidedAtMs: nowMs,
          expiresAtMs: null,
        }
      );
      const timestamp = FieldValue.serverTimestamp();
      const existingCreatedAt = reportSnapshot.exists
        ? reportSnapshot.data()?.['createdAt'] ?? timestamp
        : timestamp;

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
          reporterUid: uid,
          targetType: 'profile',
          targetId: uid,
          targetOwnerUid: uid,
          targetAuthorUid: uid,
          reason: 'age_verification_request',
          details: [
            'Solicitação do titular para verificação ou contestação',
            'de maioridade por fonte confiável.',
          ].join(' '),
          route: '/adulto/verificar-idade',
          status: 'open',
          moderationAction: null,
          resolution: null,
          reviewedBy: null,
          reviewedAt: null,
          source: 'system',
          createdAt: existingCreatedAt,
          updatedAt: timestamp,
          requestedAtMs: nowMs,
        },
        { merge: true }
      );

      transaction.create(db.collection('compliance_audit').doc(), {
        uid,
        type: 'age_eligibility.initial_review_requested',
        reportId,
        previousStatus: current.status,
        source: 'web',
        createdAt: timestamp,
        createdAtMs: nowMs,
      });

      return {
        reportId,
        status: 'REVIEW_REQUIRED' as const,
        notify: true,
      };
    });

    if (result.notify && result.reportId) {
      await safeNotifyInitialAgeEligibilityOutcome({
        assertionId: `${result.reportId}:${nowMs}`,
        uid,
        status: 'REVIEW_REQUIRED',
      });
    }

    return {
      reportId: result.reportId,
      status: result.status,
    };
  }
);
