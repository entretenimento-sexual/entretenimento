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
  safeNotifyInitialAgeEligibilityOutcome,
} from '../moderation/moderation-safety-notification.service';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  writeCanonicalAgeEligibilityInTransaction,
} from './age-eligibility.service';
import {
  TERMS_ACCEPTANCE_VERSION,
} from './platform-legal.constants';
import {
  assertComplianceAuthenticatedUid,
} from './profile-age-reverification.shared';

interface RequestInitialAgeVerificationReviewResponse {
  reportId: string | null;
  status:
    | 'SELF_DECLARED_ADULT'
    | 'VERIFIED_ADULT'
    | 'REVIEW_REQUIRED';
}

function initialAgeReportId(uid: string): string {
  const digest = createHash('sha256')
    .update(uid)
    .digest('hex')
    .slice(0, 40);

  return `age_initial_${digest}`;
}

function hasCurrentTerms(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const terms = raw as Record<string, unknown>;

  return terms['accepted'] === true &&
    String(terms['version'] ?? '').trim() === TERMS_ACCEPTANCE_VERSION &&
    terms['acknowledgedPrivacyNotice'] === true;
}

export const requestInitialAgeVerificationReview = onCall(
  { region: FUNCTIONS_REGION },
  async (
    request
  ): Promise<RequestInitialAgeVerificationReviewResponse> => {
    const uid = assertComplianceAuthenticatedUid(request.auth);

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Confirme seu e-mail antes de solicitar a verificação de maioridade.',
        {
          reason: 'email_verification_required',
          recommendedAction: 'verify_email',
        }
      );
    }

    const nowMs = Date.now();
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

      const user = userSnapshot.data() ?? {};

      if (!hasCurrentTerms(user['acceptedTerms'])) {
        throw new HttpsError(
          'failed-precondition',
          'Aceite os termos vigentes antes de solicitar a verificação de maioridade.',
          {
            reason: 'terms_required',
            recommendedAction: 'accept_terms',
          }
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
