// functions/src/compliance/declare-adult-age-access.handler.ts
// -----------------------------------------------------------------------------
// DECLARE ADULT AGE ACCESS
// -----------------------------------------------------------------------------
// Registra, no backend, a autodeclaração 18+ usada pelo modo operacional
// DECLARATION_FIRST.
//
// Importante:
// - não representa prova forte de maioridade;
// - nunca produz VERIFIED_ADULT;
// - não contorna denúncia/reverificação etária já ativa;
// - pode substituir somente o REVIEW_REQUIRED legado criado pela antiga
//   solicitação inicial sem provedor/equipe operacional.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  AGE_ACCESS_ALLOWS_SELF_DECLARATION,
} from './age-access-policy.generated';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
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

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

interface DeclareAdultAgeAccessRequest {
  declaresAdult?: boolean;
}

interface DeclareAdultAgeAccessResponse {
  status: 'DECLARED_ADULT' | 'VERIFIED_ADULT';
  assurance: 'SELF_DECLARATION' | 'VERIFIED';
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

function hasActiveAgeReverification(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const status = String(
    (raw as Record<string, unknown>)['status'] ?? ''
  ).trim().toUpperCase();

  return (
    status === 'REQUIRED' ||
    status === 'SUBMITTED' ||
    status === 'UNDER_REVIEW' ||
    status === 'EXPIRED'
  );
}

function isLegacyInitialReview(input: {
  status: string;
  source: string | null;
  method: string | null;
  caseId: string | null;
}): boolean {
  return input.status === 'REVIEW_REQUIRED' &&
    input.source === 'INITIAL_VERIFICATION' &&
    input.method === 'MANUAL_REVIEW' &&
    String(input.caseId ?? '').startsWith('age_initial_');
}

export const declareAdultAgeAccess = onCall<DeclareAdultAgeAccessRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request): Promise<DeclareAdultAgeAccessResponse> => {
    const uid = assertComplianceAuthenticatedUid(request.auth);

    if (!AGE_ACCESS_ALLOWS_SELF_DECLARATION) {
      throw new HttpsError(
        'failed-precondition',
        'A política atual exige verificação forte de maioridade.',
        {
          reason: 'strong_age_verification_required',
          recommendedAction: 'complete_age_verification',
        }
      );
    }

    if (request.data?.declaresAdult !== true) {
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
          'Conta ainda não possui cadastro interno válido.'
        );
      }

      const user = userSnapshot.data() ?? {};

      if (!hasCurrentTerms(user['acceptedTerms'])) {
        throw new HttpsError(
          'failed-precondition',
          'Aceite os termos vigentes antes de confirmar o acesso adulto.',
          {
            reason: 'terms_required',
            recommendedAction: 'accept_terms',
          }
        );
      }

      if (hasActiveAgeReverification(user['ageReverification'])) {
        throw new HttpsError(
          'failed-precondition',
          'Esta conta possui uma revalidação etária de segurança em andamento.',
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

      if (current.allowed) {
        return {
          status:
            current.status === 'VERIFIED_ADULT'
              ? 'VERIFIED_ADULT'
              : 'DECLARED_ADULT',
          assurance:
            current.status === 'VERIFIED_ADULT'
              ? 'VERIFIED'
              : 'SELF_DECLARATION',
        };
      }

      if (current.status === 'DENIED_UNDERAGE') {
        throw new HttpsError(
          'permission-denied',
          'O acesso adulto não está disponível para esta conta.',
          {
            reason: 'underage',
            recommendedAction: 'account_support',
          }
        );
      }

      const legacyReview = isLegacyInitialReview({
        status: current.status,
        source: current.source,
        method: current.method,
        caseId: current.caseId,
      });

      if (current.status === 'REVIEW_REQUIRED' && !legacyReview) {
        throw new HttpsError(
          'failed-precondition',
          'Esta conta possui uma análise etária de segurança em andamento.',
          {
            reason: 'review_required',
            recommendedAction: 'complete_age_review',
          }
        );
      }

      const projection = writeCanonicalAgeEligibilityInTransaction(
        transaction,
        {
          uid,
          status: 'DECLARED_ADULT',
          source: 'INITIAL_DECLARATION',
          method: 'SELF_DECLARATION',
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

      if (legacyReview && current.caseId) {
        const reportRef = db.collection('moderation_reports').doc(current.caseId);
        transaction.set(
          reportRef,
          {
            status: 'rejected',
            moderationAction: 'KEEP',
            resolution:
              'Encerrado automaticamente após adoção da política inicial de autodeclaração adulta.',
            reviewedBy: 'system:age-access-policy',
            reviewedAt: timestamp,
            updatedAt: timestamp,
          },
          { merge: true }
        );
      }

      transaction.create(db.collection('compliance_audit').doc(), {
        uid,
        type: 'age_eligibility.adult_self_declared',
        source: 'web',
        assurance: 'SELF_DECLARATION',
        policyMode: 'DECLARATION_FIRST',
        replacedLegacyInitialReview: legacyReview,
        previousStatus: current.status,
        createdAt: timestamp,
        createdAtMs: nowMs,
      });

      return {
        status: 'DECLARED_ADULT',
        assurance: 'SELF_DECLARATION',
      };
    });
  }
);
