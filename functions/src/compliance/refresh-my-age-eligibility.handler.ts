// functions/src/compliance/refresh-my-age-eligibility.handler.ts
// -----------------------------------------------------------------------------
// REFRESH MY AGE ELIGIBILITY
// -----------------------------------------------------------------------------
// Reconcilia apenas fontes backend confiáveis.
// - nunca promove idade social, data de nascimento client-side, adultConsent
//   ou ageVerification legado;
// - repara users/{uid}.ageEligibility a partir da autoridade canônica;
// - se a autoridade canônica estiver ausente/inválida, pode restaurar a
//   autodeclaração provisória a partir da evidência histórica imutável
//   adult_self_declarations/{uid}, sem pedir nova declaração ao usuário;
// - decisões fortes/restrições nunca são rebaixadas por autodeclaração.
// -----------------------------------------------------------------------------

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

interface RefreshMyAgeEligibilityResponse {
  status:
    | 'UNVERIFIED'
    | 'SELF_DECLARED_ADULT'
    | 'VERIFIED_ADULT'
    | 'DENIED_UNDERAGE'
    | 'REVIEW_REQUIRED'
    | 'EXPIRED';
  migrated: boolean;
  restoredFromDeclarationEvidence: boolean;
  ageEligibility: AgeEligibilityProjection | null;
}

function cleanUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function positiveTime(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) && millis > 0
      ? Math.trunc(millis)
      : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function trustedSelfDeclarationAtMs(
  value: unknown,
  expectedUid: string
): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const declaration = value as Record<string, unknown>;

  if (
    String(declaration['uid'] ?? '').trim() !== expectedUid ||
    Number(declaration['schemaVersion']) !== 1 ||
    declaration['type'] !== 'adult_self_declaration' ||
    declaration['declaration'] !== '18_PLUS' ||
    declaration['voluntary'] !== true ||
    declaration['explicitConfirmation'] !== true ||
    declaration['immutable'] !== true
  ) {
    return null;
  }

  return positiveTime(declaration['declaredAtMs'])
    ?? positiveTime(declaration['declaredAt']);
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
      const declarationRef = db
        .collection('adult_self_declarations')
        .doc(uid);

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
          'Conta ainda não possui cadastro interno válido.'
        );
      }

      const nowMs = Date.now();
      const currentDecision = evaluateCanonicalAgeEligibility({
        uid,
        rawRecord: recordSnapshot.exists ? recordSnapshot.data() : null,
        nowMs,
      });

      /**
       * Estados canônicos válidos são simplesmente reprojetados.
       * SELF_DECLARED_ADULT só entra aqui quando allowed=true; registros
       * desatualizados/inconsistentes não podem manter autorização por nome.
       */
      const currentIsUsable =
        (
          currentDecision.status === 'SELF_DECLARED_ADULT' ||
          currentDecision.status === 'VERIFIED_ADULT'
        )
          ? currentDecision.allowed === true
          : (
            currentDecision.status === 'DENIED_UNDERAGE' ||
            currentDecision.status === 'REVIEW_REQUIRED' ||
            currentDecision.status === 'EXPIRED'
          );

      if (currentIsUsable) {
        const projection = projectionFromCanonicalAgeDecision(
          currentDecision,
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

        return {
          status: currentDecision.status,
          migrated: false,
          restoredFromDeclarationEvidence: false,
          ageEligibility: projection,
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

      /**
       * Decisão forte sempre vence a evidência histórica de autodeclaração.
       */
      if (trustedAdult || trustedUnderage) {
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
          createdAtMs: nowMs,
        });

        return {
          status: projection.status,
          migrated: true,
          restoredFromDeclarationEvidence: false,
          ageEligibility: projection,
        };
      }

      /**
       * Uma reverificação/restrição em andamento também vence a autodeclaração.
       * Não reconstruímos SELF_DECLARED_ADULT enquanto existir fato novo de
       * segurança que exija revisão.
       */
      if (isAgeReverificationAssuranceUnresolved(reverificationStatus)) {
        return {
          status: 'REVIEW_REQUIRED',
          migrated: false,
          restoredFromDeclarationEvidence: false,
          ageEligibility: null,
        };
      }

      /**
       * Se o usuário já declarou 18+ em uma evidência backend-only válida,
       * restauramos o estado provisório sem pedir a mesma declaração novamente.
       */
      const declaredAtMs = declarationSnapshot.exists
        ? trustedSelfDeclarationAtMs(
          declarationSnapshot.data(),
          uid
        )
        : null;

      if (declaredAtMs !== null) {
        const projection = writeCanonicalAgeEligibilityInTransaction(
          transaction,
          {
            uid,
            status: 'SELF_DECLARED_ADULT',
            source: 'SELF_DECLARATION',
            method: 'SELF_DECLARATION',
            caseId: null,
            verifiedAtMs: null,
            decidedAtMs: declaredAtMs,
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
          type: 'age_eligibility.self_declaration_restored',
          source: 'system',
          declarationEvidencePath: declarationRef.path,
          declaredAtMs,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
        });

        return {
          status: 'SELF_DECLARED_ADULT',
          migrated: true,
          restoredFromDeclarationEvidence: true,
          ageEligibility: projection,
        };
      }

      return {
        status: 'UNVERIFIED',
        migrated: false,
        restoredFromDeclarationEvidence: false,
        ageEligibility: null,
      };
    });
  }
);
