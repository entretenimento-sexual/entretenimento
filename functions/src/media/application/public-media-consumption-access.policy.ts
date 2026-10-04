import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertPlatformAccountAccessData,
} from '../../account_lifecycle/interaction-access.policy';
import { db } from '../../firebaseApp';

export type PublicMediaConsumptionAccessReason =
  | 'ACCOUNT_UNAVAILABLE'
  | 'TERMS_REQUIRED'
  | 'ADULT_CONSENT_REQUIRED';

interface PublicMediaConsumptionAccessUserDocument {
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  moderationAutomationHold?: {
    active?: unknown;
    expiresAtMs?: unknown;
  } | null;
  acceptedTerms?: unknown;
  adultConsent?: unknown;
}

function mapAccountReason(error: HttpsError):
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
  user: PublicMediaConsumptionAccessUserDocument | null | undefined
): void {
  try {
    assertPlatformAccountAccessData(user);
  } catch (error) {
    if (!(error instanceof HttpsError)) {
      throw error;
    }

    const reason = mapAccountReason(error);

    throw consumptionAccessError(
      reason === 'TERMS_REQUIRED'
        ? 'Aceite os termos vigentes antes de acessar este conteúdo.'
        : reason === 'ADULT_CONSENT_REQUIRED'
          ? 'Aceite o acesso à experiência adulta antes de continuar.'
          : 'Esta conta não pode acessar conteúdo público no momento.',
      reason,
      error
    );
  }
}

export async function assertPublicMediaConsumptionAccess(
  uid: string
): Promise<void> {
  const userSnapshot = await db.collection('users').doc(uid).get();

  assertPublicMediaConsumptionAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as PublicMediaConsumptionAccessUserDocument
      : null
  );
}
