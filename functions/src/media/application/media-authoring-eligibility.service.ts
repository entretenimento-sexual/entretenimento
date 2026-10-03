import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessData,
} from '../../account_lifecycle/interaction-access.policy';
import {
  type AgeEligibilityDecision,
  evaluateCanonicalAgeEligibility,
} from '../../compliance/age-eligibility.policy';
import { db } from '../../firebaseApp';

interface MediaAuthoringAccountSnapshot {
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  acceptedTerms?: unknown;
  adultConsent?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
}

export interface MediaAuthoringEligibilityDecision {
  readonly ageEligibility: Readonly<AgeEligibilityDecision>;
  readonly ageEligibilityValidUntilMs: number | null;
  readonly ageEligibilityVerifiedAdult: boolean;
}

/**
 * Fronteira canônica de AUTORIA de mídia.
 *
 * Importante:
 * - autoria/upload não é consumo de mídia pública;
 * - a conta precisa estar apta ao ambiente adulto e ao lifecycle normal;
 * - SELF_DECLARED_ADULT continua sendo elegibilidade adulta válida quando
 *   registrada pela autoridade backend;
 * - uma verificação forte pode existir como assurance adicional, mas não é
 *   reexigida em cada upload/publicação;
 * - segurança do conteúdo é uma autoridade separada e permanece no pipeline
 *   preventivo de moderação/quarentena.
 */
export function assertMediaAuthoringEligibilityData(
  user: MediaAuthoringAccountSnapshot | null | undefined,
  ageEligibilityRecord: unknown,
  uid: string
): MediaAuthoringEligibilityDecision {
  try {
    assertInteractionAccessData(user, ageEligibilityRecord, uid);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      'failed-precondition',
      'Esta conta não pode enviar mídia no momento.'
    );
  }

  const ageEligibility = evaluateCanonicalAgeEligibility({
    uid,
    rawRecord: ageEligibilityRecord,
  });

  if (!ageEligibility.allowed) {
    throw new HttpsError(
      ageEligibility.denialReason === 'underage'
        ? 'permission-denied'
        : 'failed-precondition',
      ageEligibility.denialReason === 'underage'
        ? 'O envio de mídia adulta não está disponível para esta conta.'
        : 'Conclua a etapa de maioridade da conta antes de enviar mídia.',
      {
        reason: ageEligibility.denialReason,
      }
    );
  }

  return {
    ageEligibility,
    ageEligibilityValidUntilMs: ageEligibility.expiresAtMs ?? null,
    ageEligibilityVerifiedAdult:
      ageEligibility.status === 'VERIFIED_ADULT' &&
      ageEligibility.verifiedAtMs !== null,
  };
}

export async function assertMediaAuthoringEligibility(
  uid: string
): Promise<MediaAuthoringEligibilityDecision> {
  const normalizedUid = String(uid ?? '').trim();

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedUid)) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const [userSnapshot, ageEligibilitySnapshot] = await Promise.all([
    db.doc(`users/${normalizedUid}`).get(),
    db.doc(`age_eligibility_records/${normalizedUid}`).get(),
  ]);

  return assertMediaAuthoringEligibilityData(
    userSnapshot.exists
      ? userSnapshot.data() as MediaAuthoringAccountSnapshot
      : null,
    ageEligibilitySnapshot.exists
      ? ageEligibilitySnapshot.data()
      : null,
    normalizedUid
  );
}
