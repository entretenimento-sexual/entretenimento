import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
  assertInteractionAccessInTransaction,
  assertPlatformAccountAccessData,
  type PlatformAccountAccessContext,
} from '../../account_lifecycle/interaction-access.policy';

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

  if (reason === 'terms_required') return 'TERMS_REQUIRED';
  if (reason === 'adult_consent_required') return 'ADULT_CONSENT_REQUIRED';
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

function remapAccountAccessError(error: unknown): never {
  if (!(error instanceof HttpsError)) throw error;

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

export function assertPublicMediaConsumptionAccessData(
  user: PublicMediaConsumptionAccessUserDocument | null | undefined
): void {
  try {
    assertPlatformAccountAccessData(user);
  } catch (error) {
    remapAccountAccessError(error);
  }
}

export async function assertPublicMediaConsumptionAccess(
  uid: string
): Promise<PlatformAccountAccessContext> {
  try {
    return await assertInteractionAccess(uid);
  } catch (error) {
    return remapAccountAccessError(error);
  }
}

/** Read canonical Account Access in the same transaction as a Media mutation.
 * Keep the same public Media error reasons used by the preflight check.
 */
export async function assertPublicMediaConsumptionAccessInTransaction(
  transaction: Transaction,
  uid: string
): Promise<PlatformAccountAccessContext> {
  try {
    return await assertInteractionAccessInTransaction(transaction, uid);
  } catch (error) {
    return remapAccountAccessError(error);
  }
}
