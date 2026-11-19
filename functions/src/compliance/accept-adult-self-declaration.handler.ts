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

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  projectionFromCanonicalAgeDecision,
  writeCanonicalAgeEligibilityInTransaction,
  type AgeEligibilityProjection,
} from './age-eligibility.service';
import {
  isAgeReverificationAssuranceUnresolved,
} from './profile-age-reverification.policy';
import {
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from './platform-legal.constants';
import {
  requiresTrustedAdultVerification,
  writeAdultSelfDeclarationEvidence,
} from './adult-self-declaration-evidence';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

interface AcceptAdultSelfDeclarationRequest {
  confirmsAdult?: boolean;
  expectedUid: unknown;
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

function positiveEpochMs(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as {toMillis?: unknown}).toMillis === 'function'
  ) {
    const millis = (value as {toMillis: () => number}).toMillis();
    return Number.isFinite(millis) && millis > 0
      ? Math.trunc(millis)
      : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : null;
}

function legalSnapshot(value: unknown) {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};

  return {
    termsAcceptanceVersion:
      String(record['version'] ?? '').trim() || TERMS_ACCEPTANCE_VERSION,
    termsDocumentVersion:
      String(record['termsDocumentVersion'] ?? '').trim()
      || TERMS_DOCUMENT_VERSION,
    privacyNoticeVersion:
      String(record['privacyNoticeVersion'] ?? '').trim()
      || PRIVACY_NOTICE_VERSION,
    termsAcceptedAtMs:
      positiveEpochMs(record['acceptedAt'])
      ?? positiveEpochMs(record['date']),
    termsAcceptanceContext:
      String(record['acceptanceContext'] ?? '').trim() || null,
  };
}

async function findFirstLegacySelfDeclarationAtMs(
  uid: string
): Promise<number | null> {
  const prefix = `age_self_declaration_${uid}_`;
  const snapshot = await db
    .collection('compliance_audit')
    .orderBy(FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}\uf8ff`)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const data = snapshot.docs[0]?.data() ?? {};
  return positiveEpochMs(data['createdAtMs'])
    ?? positiveEpochMs(data['createdAt']);
}

export const acceptAdultSelfDeclaration =
  onCall<AcceptAdultSelfDeclarationRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: ENFORCE_APP_CHECK,
    },
    async (request): Promise<{
      uid: string;
      status: 'SELF_DECLARED_ADULT' | 'VERIFIED_ADULT';
      declaredAtMs: number | null;
      ageEligibility: AgeEligibilityProjection;
    }> => {
      const uid = String(request.auth?.uid ?? '').trim();

      if (!uid) {
        throw new HttpsError(
          'unauthenticated',
          'Faça login para confirmar sua maioridade.'
        );
      }

      if (typeof request.data?.expectedUid !== 'string' || !request.data.expectedUid) {
        throw new HttpsError('invalid-argument', 'Identifique a conta que fez a declaração.');
      }
      if (request.data.expectedUid !== uid) {
        throw new HttpsError('permission-denied', 'A conta ativa mudou durante a confirmação de maioridade.', {
          reason: 'auth/session-changed',
        });
      }
      await assertRegistrationPasswordDefined(uid);

      if (request.auth?.token?.email_verified !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Confirme seu e-mail antes de continuar.'
        );
      }

      if (requiresTrustedAdultVerification) {
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
      const declarationRef = db
        .collection('adult_self_declarations')
        .doc(uid);
      const legacyDeclaredAtMs =
        await findFirstLegacySelfDeclarationAtMs(uid);

      return db.runTransaction(async (transaction) => {
        const [
          userSnapshot,
          recordSnapshot,
          declarationSnapshot,
        ] = await Promise.all([
          transaction.get(userRef),
          transaction.get(recordRef),
          transaction.get(declarationRef),
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

        if (isAgeReverificationAssuranceUnresolved(
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

        const existingDeclaration = declarationSnapshot.exists
          ? declarationSnapshot.data() ?? {}
          : null;
        const existingDeclaredAtMs = existingDeclaration
          ? positiveEpochMs(existingDeclaration['declaredAtMs'])
            ?? positiveEpochMs(existingDeclaration['declaredAt'])
          : null;

        if (existingDeclaration && existingDeclaredAtMs === null) {
          throw new HttpsError(
            'internal',
            'O registro histórico de maioridade está inconsistente.'
          );
        }

        const declaredAtMs =
          existingDeclaredAtMs
          ?? legacyDeclaredAtMs
          ?? nowMs;
        if (!existingDeclaration) {
          writeAdultSelfDeclarationEvidence(transaction, {
            uid,
            declaredAtMs,
            origin: legacyDeclaredAtMs === null ? 'LIVE_DECLARATION' : 'MIGRATED_EXISTING_AUDIT',
            legal: legalSnapshot(user['acceptedTerms']),
          });
        }

        if (current.status === 'VERIFIED_ADULT' && current.allowed) {
          const projection = projectionFromCanonicalAgeDecision(
            current,
            nowMs
          );

          if (!projection) {
            throw new HttpsError(
              'internal',
              'A projeção canônica de maioridade não pôde ser reconstruída.'
            );
          }

          transaction.set(
            userRef,
            {
              ageEligibility: projection,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          return {
            uid,
            status: 'VERIFIED_ADULT' as const,
            declaredAtMs,
            ageEligibility: projection,
          };
        }

        if (current.status === 'SELF_DECLARED_ADULT' && current.allowed) {
          const projection = projectionFromCanonicalAgeDecision(
            current,
            nowMs
          );

          if (projection) {
            transaction.set(
              userRef,
              {
                ageEligibility: projection,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }

          if (!projection) {
            throw new HttpsError(
              'internal',
              'A projeção canônica de maioridade não pôde ser reconstruída.'
            );
          }

          return {
            uid,
            status: 'SELF_DECLARED_ADULT' as const,
            declaredAtMs,
            ageEligibility: projection,
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

        const timestamp = FieldValue.serverTimestamp();

        transaction.set(
          userRef,
          {
            ageEligibility: projection,
            updatedAt: timestamp,
          },
          { merge: true }
        );

        return {
          uid,
          status: 'SELF_DECLARED_ADULT' as const,
          declaredAtMs,
          ageEligibility: projection,
        };
      });
    }
  );
import { assertRegistrationPasswordDefined } from '../registration/email-link-preview.handler';
