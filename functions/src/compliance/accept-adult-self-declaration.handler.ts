// functions/src/compliance/accept-adult-self-declaration.handler.ts
// -----------------------------------------------------------------------------
// PROVISIONAL ADULT SELF-DECLARATION
// -----------------------------------------------------------------------------
// Operational mode used while no trusted age provider is contracted.
//
// Important:
// - SELF_DECLARED_ADULT is not VERIFIED_ADULT;
// - the browser cannot write the canonical age record directly;
// - stronger states (REVIEW_REQUIRED / DENIED_UNDERAGE) cannot be overridden;
// - future provider/KYC integration can replace this admission basis without
//   changing the canonical age domain.
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

const AGE_ADMISSION_MODE =
  String(process.env.AGE_ADMISSION_MODE ?? 'SELF_DECLARATION')
    .trim()
    .toUpperCase() === 'VERIFIED_REQUIRED'
    ? 'VERIFIED_REQUIRED'
    : 'SELF_DECLARATION';

interface AcceptAdultSelfDeclarationRequest {
  confirmsAdult?: boolean;
}

function hasAcceptedCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;

  return (
    record['accepted'] === true &&
    String(record['version'] ?? '').trim() === TERMS_ACCEPTANCE_VERSION &&
    record['acknowledgedPrivacyNotice'] === true
  );
}

export const acceptAdultSelfDeclaration =
  onCall<AcceptAdultSelfDeclarationRequest>(
    { region: FUNCTIONS_REGION },
    async (request): Promise<{
      status: 'SELF_DECLARED_ADULT' | 'VERIFIED_ADULT';
      declaredAtMs: number | null;
    }> => {
      const uid = String(request.auth?.uid ?? '').trim();

      if (!uid) {
        throw new HttpsError(
          'unauthenticated',
          'Faça login para confirmar sua maioridade.'
        );
      }

      if (request.auth?.token?.email_verified !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Confirme seu e-mail antes de continuar.'
        );
      }

      if (AGE_ADMISSION_MODE === 'VERIFIED_REQUIRED') {
        throw new HttpsError(
          'failed-precondition',
          'A política atual exige verificação de maioridade por uma fonte confiável.'
        );
      }

      if (request.data?.confirmsAdult !== true) {
        throw new HttpsError(
          'invalid-argument',
          'Confirme explicitamente que você tem 18 anos ou mais.'
        );
      }

      const nowMs = Date.now();
      const userRef = db.collection('users').doc(uid);
      const recordRef = db.collection('age_eligibility_records').doc(uid);
      const auditRef = db
        .collection('compliance_audit')
        .doc(`age_self_declaration_${uid}_${nowMs}`);

      return db.runTransaction(async (transaction) => {
        const [userSnapshot, recordSnapshot] = await Promise.all([
          transaction.get(userRef),
          transaction.get(recordRef),
        ]);

        if (!userSnapshot.exists) {
          throw new HttpsError(
            'failed-precondition',
            'Conclua a criação da conta antes de confirmar sua maioridade.'
          );
        }

        const user = userSnapshot.data() ?? {};

        if (!hasAcceptedCurrentTerms(user['acceptedTerms'])) {
          throw new HttpsError(
            'failed-precondition',
            'Aceite os termos vigentes antes de confirmar sua maioridade.'
          );
        }

        if (isAgeReverificationAccessRestricted(
          (user['ageReverification'] as Record<string, unknown> | null)
            ?.['status']
        )) {
          throw new HttpsError(
            'failed-precondition',
            'Sua conta possui uma verificação de segurança em andamento.'
          );
        }

        const current = evaluateCanonicalAgeEligibility({
          uid,
          rawRecord: recordSnapshot.exists ? recordSnapshot.data() : null,
          nowMs,
        });

        if (current.status === 'VERIFIED_ADULT' && current.allowed) {
          return {
            status: 'VERIFIED_ADULT' as const,
            declaredAtMs: null,
          };
        }

        if (current.status === 'DENIED_UNDERAGE') {
          throw new HttpsError(
            'permission-denied',
            'O acesso adulto não está disponível para esta conta.'
          );
        }

        if (current.status === 'REVIEW_REQUIRED') {
          throw new HttpsError(
            'failed-precondition',
            'Sua conta possui uma verificação de segurança em andamento.'
          );
        }

        if (current.status === 'SELF_DECLARED_ADULT' && current.allowed) {
          return {
            status: 'SELF_DECLARED_ADULT' as const,
            declaredAtMs: nowMs,
          };
        }

        const projection = writeCanonicalAgeEligibilityInTransaction(
          transaction,
          {
            uid,
            status: 'SELF_DECLARED_ADULT',
            source: 'SELF_DECLARATION',
            method: 'SELF_DECLARATION',
            caseId: null,
            verifiedAtMs: null,
            decidedAtMs: nowMs,
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

        transaction.create(auditRef, {
          uid,
          type: 'age_eligibility.self_declared_adult',
          policyVersion: projection.policyVersion,
          source: 'web',
          declaration: '18_PLUS',
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
        });

        return {
          status: 'SELF_DECLARED_ADULT' as const,
          declaredAtMs: nowMs,
        };
      });
    }
  );
