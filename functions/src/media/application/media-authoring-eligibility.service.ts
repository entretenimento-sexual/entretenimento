import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
  assertPlatformAccountAccessData,
} from '../../account_lifecycle/interaction-access.policy';

interface MediaAuthoringAccountSnapshot {
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

export interface MediaAuthoringEligibilityDecision {
  readonly allowed: true;
}

export function assertMediaAuthoringEligibilityData(
  user: MediaAuthoringAccountSnapshot | null | undefined
): MediaAuthoringEligibilityDecision {
  assertPlatformAccountAccessData(user);
  return { allowed: true };
}

export async function assertMediaAuthoringEligibility(
  uid: string
): Promise<MediaAuthoringEligibilityDecision> {
  const normalizedUid = String(uid ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedUid)) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  await assertInteractionAccess(normalizedUid);
  return { allowed: true };
}
