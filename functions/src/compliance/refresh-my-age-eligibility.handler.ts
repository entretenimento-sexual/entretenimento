// functions/src/compliance/refresh-my-age-eligibility.handler.ts
// -----------------------------------------------------------------------------
// REFRESH MY AGE ELIGIBILITY
// -----------------------------------------------------------------------------
// Reconcilia somente fontes backend já confiáveis. Nunca promove idade, data de
// nascimento client-side, adultConsent ou ageVerification legado.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  writeCanonicalAgeEligibilityInTransaction,
} from './age-eligibility.service';

interface RefreshMyAgeEligibilityResponse {
  status:
    | 'UNVERIFIED'
    | 'SELF_DECLARED_ADULT'
    | 'VERIFIED_ADULT'
    | 'DENIED_UNDERAGE'
    | 'REVIEW_REQUIRED'
    | 'EXPIRED';
  migrated: boolean;
}

function cleanUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function positiveTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export const refreshMyAgeEligibility = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RefreshMyAgeEligibilityResponse> => {
    const uid = cleanUid(request.auth?.uid);

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    return db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const recordRef = db.collection('age_eligibility_records').doc(uid);
      const [userSnapshot, recordSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(recordRef),
      ]);

      if (!userSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Conta ainda não possui cadastro interno válido.'
        );
      }

      const currentDecision = evaluateCanonicalAgeEligibility({
        uid,
        rawRecord: recordSnapshot.exists ? recordSnapshot.data() : null,
      });

      if (
        currentDecision.status === 'SELF_DECLARED_ADULT' ||
        currentDecision.status === 'VERIFIED_ADULT' ||
        currentDecision.status === 'DENIED_UNDERAGE' ||
        currentDecision.status === 'REVIEW_REQUIRED' ||
        currentDecision.status === 'EXPIRED'
      ) {
        return {
          status: currentDecision.status,
          migrated: false,
        };
      }

      const user = userSnapshot.data() ?? {};
      const ageReverification = (
        user['ageReverification'] &&
        typeof user['ageReverification'] === 'object'
      )
        ? user['ageReverification'] as Record<string, unknown>
        : null;
      const reverificationStatus = String(
        ageReverification?.['status'] ?? ''
      ).trim().toUpperCase();
      const reverificationResult = String(
        ageReverification?.['result'] ?? ''
      ).trim().toUpperCase();
      const reviewedAt = positiveTime(
        ageReverification?.['reviewedAt']
      );
      const caseId = cleanUid(ageReverification?.['caseId']) || null;

      const trustedAdult =
        reverificationStatus === 'VERIFIED' &&
        reverificationResult === 'ADULT' &&
        reviewedAt !== null;
      const trustedUnderage =
        reverificationStatus === 'REJECTED' &&
        reverificationResult === 'UNDERAGE' &&
        reviewedAt !== null;

      if (!trustedAdult && !trustedUnderage) {
        return {
          status: 'UNVERIFIED',
          migrated: false,
        };
      }

      const projection = writeCanonicalAgeEligibilityInTransaction(
        transaction,
        {
          uid,
          status: trustedAdult
            ? 'VERIFIED_ADULT'
            : 'DENIED_UNDERAGE',
          source: 'MIGRATION',
          method: 'MIGRATED_REVIEW',
          caseId,
          verifiedAtMs: trustedAdult ? reviewedAt : null,
          decidedAtMs: reviewedAt!,
          expiresAtMs: null,
        }
      );

      transaction.set(
        userRef,
        {
          ageEligibility: projection,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      transaction.create(db.collection('compliance_audit').doc(), {
        uid,
        type: trustedAdult
          ? 'age_eligibility.migrated_adult_review'
          : 'age_eligibility.migrated_underage_review',
        source: 'system',
        caseId,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
      });

      return {
        status: projection.status,
        migrated: true,
      };
    });
  }
);
