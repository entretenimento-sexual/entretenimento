import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} from '../compliance/platform-legal.constants';
import { db } from '../firebaseApp';

interface InteractionAccessUserDocument {
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

function hasCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const terms = value as Record<string, unknown>;
  return terms['accepted'] === true &&
    String(terms['version'] ?? '').trim() === TERMS_ACCEPTANCE_VERSION &&
    terms['acknowledgedPrivacyNotice'] === true;
}

function hasCurrentAdultConsent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const consent = value as Record<string, unknown>;
  return consent['accepted'] === true &&
    String(consent['version'] ?? '').trim() === ADULT_CONSENT_VERSION;
}

export async function assertInteractionAccess(
  uid: string
): Promise<void> {
  const userSnapshot = await db.collection('users').doc(uid).get();

  assertPlatformAccountAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null
  );
}

export async function assertInteractionAccessInTransaction(
  transaction: Transaction,
  uid: string
): Promise<void> {
  const userSnapshot = await transaction.get(
    db.collection('users').doc(uid)
  );

  assertPlatformAccountAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null
  );
}
