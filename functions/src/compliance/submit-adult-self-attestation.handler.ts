// functions/src/compliance/submit-adult-self-attestation.handler.ts
// -----------------------------------------------------------------------------
// ADULT SELF ATTESTATION
// -----------------------------------------------------------------------------
// Política operacional transitória:
// - registra no backend uma declaração explícita de que o titular tem 18+;
// - nunca materializa SELF_ATTESTATION como VERIFIED_ADULT;
// - não sobrepõe decisão de menoridade nem restrição por denúncia/revalidação;
// - pode ser substituída futuramente por provedor/KYC sem migrar o histórico.
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
import {
  isAgeReverificationAccessRestricted,
} from './profile-age-reverification.policy';
import {
  TERMS_ACCEPTANCE_VERSION,
} from './platform-legal.constants';
import {
  assertComplianceAuthenticatedUid,
} from './profile-age-reverification.shared';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const SELF_ATTESTATION_VERSION = 1;

interface SubmitAdultSelfAttestationRequest {
  declaredAdult?: boolean;
  attestationVersion?: number;
}

interface SubmitAdultSelfAttestationResponse {
  status: 'DECLARED_ADULT' | 'VERIFIED_ADULT';
  assuranceLevel: 'SELF_ATTESTED' | 'VERIFIED';
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

export const submitAdultSelfAttestation = onCall<
  SubmitAdultSelfAttestationRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request): Promise<SubmitAdultSelfAttestationResponse> => {
    const uid = assertComplianceAuthenticatedUid(request.auth);

    if (
      request.data?.declaredAdult !== true ||
      Number(request.data?.attestationVersion) !== SELF_ATTESTATION_VERSION
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Confirme explicitamente que você tem 18 anos ou mais.'
      );
    }

    const nowMs = Date.now();
    const userRef = db.collection('users').doc(uid);
    const eligibilityRef = db.collection('age_eligibility_records').doc(uid);

    return db.runTransaction(async (transaction) => {
      const [userSnapshot, eligibilitySnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(eligibilityRef),
      ]);

      if (!userSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Recupere os dados da sua conta antes de confirmar a maioridade.'
        );
      }

      const user = userSnapshot.data() ?? {};

      if (!hasCurrentTerms(user['acceptedTerms'])) {
        throw new HttpsError(
          'failed-precondition',
          'Aceite os termos vigentes antes de confirmar a maioridade.',
          {
            reason: 'terms_required',
            recommendedAction: 'accept_terms',
          }
        );
      }

      const ageReverification = (
        user['ageReverification'] &&
        typeof user['ageReverification'] === 'object'
      )
        ? user['ageReverification'] as Record<string, unknown>
        : null;

      if (
        isAgeReverificationAccessRestricted(
          ageReverification?.['status']
        )
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Esta conta possui uma revalidação de idade em andamento.',
          {
            reason: 'age_reverification_required',
            recommendedAction: 'complete_age_reverification',
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

      if (current.status === 'DENIED_UNDERAGE') {
        throw new HttpsError(
          'permission-denied',
          'O acesso adulto não está disponível para esta conta.',
          {
            reason: 'underage',
            recommendedAction: 'appeal_age_decision',
          }
        );
      }

      if (current.status === 'VERIFIED_ADULT' && current.allowed) {
        return {
          status: 'VERIFIED_ADULT',
          assuranceLevel: 'VERIFIED',
        };
      }

      if (current.status === 'DECLARED_ADULT' && current.allowed) {
        return {
          status: 'DECLARED_ADULT',
          assuranceLevel: 'SELF_ATTESTED',
        };
      }

      const isLegacyInitialReview =
        current.status === 'REVIEW_REQUIRED' &&
        current.source === 'INITIAL_VERIFICATION' &&
        current.method === 'MANUAL_REVIEW';

      if (
        current.status === 'REVIEW_REQUIRED' &&
        !isLegacyInitialReview
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Esta conta possui uma análise de segurança etária em andamento.',
          {
            reason: 'review_required',
            recommendedAction: 'review_age_safety_case',
          }
        );
      }

      const projection = writeCanonicalAgeEligibilityInTransaction(
        transaction,
        {
          uid,
          status: 'DECLARED_ADULT',
          source: 'SELF_ATTESTATION',
          method: 'SELF_ATTESTATION',
          caseId: null,
          verifiedAtMs: null,
          decidedAtMs: nowMs,
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

      if (isLegacyInitialReview && current.caseId) {
        const reportRef = db
          .collection('moderation_reports')
          .doc(current.caseId);
        const reportSnapshot = await transaction.get(reportRef);

        if (
          reportSnapshot.exists &&
          String(reportSnapshot.data()?.['reason'] ?? '') ===
            'age_verification_request'
        ) {
          transaction.set(
            reportRef,
            {
              status: 'resolved',
              moderationAction: 'KEEP',
              resolution:
                'Fluxo inicial encerrado pela política transitória de autodeclaração adulta.',
              reviewedBy: 'system:age-self-attestation',
              reviewedAt: timestamp,
              updatedAt: timestamp,
            },
            { merge: true }
          );
        }
      }

      transaction.create(db.collection('compliance_audit').doc(), {
        uid,
        type: 'age_eligibility.self_attested_adult',
        status: 'DECLARED_ADULT',
        assuranceLevel: 'SELF_ATTESTED',
        attestationVersion: SELF_ATTESTATION_VERSION,
        previousStatus: current.status,
        source: 'web',
        createdAt: timestamp,
        createdAtMs: nowMs,
      });

      return {
        status: 'DECLARED_ADULT',
        assuranceLevel: 'SELF_ATTESTED',
      };
    });
  }
);
