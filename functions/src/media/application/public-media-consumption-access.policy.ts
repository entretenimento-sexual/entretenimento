import { HttpsError } from 'firebase-functions/v2/https';

import {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} from '../../compliance/platform-legal.constants';
import { isAgeReverificationAccessRestricted } from '../../compliance/profile-age-reverification.policy';
import { db } from '../../firebaseApp';

export type PublicMediaConsumptionAccessReason =
  | 'ACCOUNT_UNAVAILABLE'
  | 'TERMS_REQUIRED'
  | 'ADULT_CONSENT_REQUIRED'
  | 'AGE_REVERIFICATION_REQUIRED';

interface PublicMediaConsumptionAccessUserDocument {
  accountStatus?: unknown;
  suspended?: unknown;
  suspensionSource?: unknown;
  acceptedTerms?: {
    accepted?: unknown;
    version?: unknown;
    acknowledgedPrivacyNotice?: unknown;
  } | null;
  adultConsent?: {
    accepted?: unknown;
    version?: unknown;
  } | null;
  initialAdultConsentRequired?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
}

function normalizeAccountStatus(
  user: PublicMediaConsumptionAccessUserDocument
): string {
  const raw = String(user.accountStatus ?? '')
    .trim()
    .toLowerCase();

  if (
    raw === 'active' ||
    raw === 'self_suspended' ||
    raw === 'moderation_suspended' ||
    raw === 'pending_deletion' ||
    raw === 'deleted'
  ) {
    return raw;
  }

  if (user.suspended === true) {
    return user.suspensionSource === 'self'
      ? 'self_suspended'
      : 'moderation_suspended';
  }

  return 'active';
}

function hasAcceptedCurrentTerms(
  value: PublicMediaConsumptionAccessUserDocument['acceptedTerms']
): boolean {
  return value?.accepted === true &&
    String(value.version ?? '').trim() === TERMS_ACCEPTANCE_VERSION &&
    value.acknowledgedPrivacyNotice === true;
}

function hasAcceptedCurrentAdultConsent(
  value: PublicMediaConsumptionAccessUserDocument['adultConsent']
): boolean {
  return value?.accepted === true &&
    String(value.version ?? '').trim() === ADULT_CONSENT_VERSION;
}

function consumptionAccessError(
  message: string,
  reason: PublicMediaConsumptionAccessReason
): HttpsError {
  return new HttpsError(
    'failed-precondition',
    message,
    { reason }
  );
}

export function assertPublicMediaConsumptionAccessData(
  user: PublicMediaConsumptionAccessUserDocument | null | undefined
): void {
  if (!user) {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  if (
    normalizeAccountStatus(user) !== 'active' ||
    user.suspended === true
  ) {
    throw consumptionAccessError(
      'Esta conta não pode acessar conteúdo público no momento.',
      'ACCOUNT_UNAVAILABLE'
    );
  }

  if (!hasAcceptedCurrentTerms(user.acceptedTerms)) {
    throw consumptionAccessError(
      'Aceite os termos vigentes antes de acessar conteúdo adulto.',
      'TERMS_REQUIRED'
    );
  }

  const adultConsentRequired = user.initialAdultConsentRequired !== false;

  if (
    adultConsentRequired &&
    !hasAcceptedCurrentAdultConsent(user.adultConsent)
  ) {
    throw consumptionAccessError(
      'Confirme o consentimento de acesso adulto antes de continuar.',
      'ADULT_CONSENT_REQUIRED'
    );
  }

  if (isAgeReverificationAccessRestricted(user.ageReverification?.status)) {
    throw consumptionAccessError(
      'Conclua a revalidação de idade antes de acessar este conteúdo.',
      'AGE_REVERIFICATION_REQUIRED'
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
