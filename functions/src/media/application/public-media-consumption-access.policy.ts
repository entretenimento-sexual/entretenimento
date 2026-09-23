import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessData,
} from '../../account_lifecycle/interaction-access.policy';
import {
  evaluateCanonicalAgeEligibility,
} from '../../compliance/age-eligibility.policy';
import { db } from '../../firebaseApp';

export type PublicMediaConsumptionAccessReason =
  | 'ACCOUNT_UNAVAILABLE'
  | 'TERMS_REQUIRED'
  | 'ADULT_CONSENT_REQUIRED'
  | 'AGE_VERIFICATION_REQUIRED'
  | 'AGE_ACCESS_DENIED'
  | 'AGE_REVERIFICATION_REQUIRED';

interface PublicMediaConsumptionAccessUserDocument {
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  acceptedTerms?: unknown;
  adultConsent?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
}

function mapInteractionReason(error: HttpsError):
PublicMediaConsumptionAccessReason {
  const reason = String(
    (error.details as { reason?: unknown } | undefined)?.reason ?? ''
  ).trim();

  if (reason === 'terms_required') {
    return 'TERMS_REQUIRED';
  }

  if (reason === 'adult_consent_required') {
    return 'ADULT_CONSENT_REQUIRED';
  }

  if (reason === 'age_reverification_required') {
    return 'AGE_REVERIFICATION_REQUIRED';
  }

  if (reason === 'underage') {
    return 'AGE_ACCESS_DENIED';
  }

  if (
    reason === 'verification_required' ||
    reason === 'review_required' ||
    reason === 'verification_expired' ||
    reason === 'record_mismatch' ||
    reason === 'policy_outdated'
  ) {
    return 'AGE_VERIFICATION_REQUIRED';
  }

  return 'ACCOUNT_UNAVAILABLE';
}

function consumptionAccessError(
  message: string,
  reason: PublicMediaConsumptionAccessReason,
  cause?: HttpsError
): HttpsError {
  return new HttpsError(
    cause?.code === 'permission-denied'
      ? 'permission-denied'
      : 'failed-precondition',
    message,
    { reason }
  );
}

export function assertPublicMediaConsumptionAccessData(
  user: PublicMediaConsumptionAccessUserDocument | null | undefined,
  ageEligibilityRecord: unknown,
  uid: string
): void {
  try {
    assertInteractionAccessData(
      user,
      ageEligibilityRecord,
      uid
    );
  } catch (error) {
    if (!(error instanceof HttpsError)) {
      throw error;
    }

    const reason = mapInteractionReason(error);

    throw consumptionAccessError(
      reason === 'TERMS_REQUIRED'
        ? 'Aceite os termos vigentes antes de acessar conteúdo adulto.'
        : reason === 'ADULT_CONSENT_REQUIRED'
          ? 'Aceite o acesso à experiência adulta antes de continuar.'
          : reason === 'AGE_VERIFICATION_REQUIRED'
            ? 'Conclua a verificação de maioridade antes de acessar este conteúdo.'
            : reason === 'AGE_ACCESS_DENIED'
              ? 'O acesso adulto não está disponível para esta conta.'
              : reason === 'AGE_REVERIFICATION_REQUIRED'
                ? 'Conclua a revalidação de idade antes de acessar este conteúdo.'
                : 'Esta conta não pode acessar conteúdo público no momento.',
      reason,
      error
    );
  }
}

export interface PublicMediaConsumptionAccessDecision {
  readonly ageEligibilityExpiresAtMs: number | null;
}

export async function assertPublicMediaConsumptionAccess(
  uid: string
): Promise<PublicMediaConsumptionAccessDecision> {
  const [userSnapshot, ageEligibilitySnapshot] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('age_eligibility_records').doc(uid).get(),
  ]);

  const rawAgeEligibility = ageEligibilitySnapshot.exists
    ? ageEligibilitySnapshot.data()
    : null;

  assertPublicMediaConsumptionAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as PublicMediaConsumptionAccessUserDocument
      : null,
    rawAgeEligibility,
    uid
  );

  const ageDecision = evaluateCanonicalAgeEligibility({
    uid,
    rawRecord: rawAgeEligibility,
  });

  return {
    ageEligibilityExpiresAtMs: ageDecision.allowed
      ? ageDecision.expiresAtMs ?? null
      : null,
  };
}
