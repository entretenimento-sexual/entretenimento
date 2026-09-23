import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  evaluateCanonicalAgeEligibility,
} from '../compliance/age-eligibility.policy';
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
  ageReverification?: {
    status?: unknown;
  } | null;
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

export function assertInteractionAccessData(
  user: InteractionAccessUserDocument | null | undefined,
  ageEligibilityRecord: unknown,
  uid: string
): void {
  if (!user) {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();
  const ageStatus = String(user.ageReverification?.status ?? '')
    .trim()
    .toUpperCase();
  const ageRestricted = ageStatus === 'REQUIRED' ||
    ageStatus === 'SUBMITTED' ||
    ageStatus === 'UNDER_REVIEW' ||
    ageStatus === 'EXPIRED';
  const holdExpiresAtMs = Number(
    user.moderationAutomationHold?.expiresAtMs ?? 0
  );
  const automationHoldActive =
    user.moderationAutomationHold?.active === true &&
    Number.isFinite(holdExpiresAtMs) &&
    Date.now() < holdExpiresAtMs;

  if (
    accountStatus !== 'active' ||
    user.suspended === true ||
    user.interactionBlocked === true ||
    automationHoldActive ||
    ageRestricted
  ) {
    throw new HttpsError(
      'failed-precondition',
      ageRestricted
        ? 'Conclua a revalidação de idade antes de realizar esta ação.'
        : 'Esta conta não pode realizar interações no momento.',
      {
        reason: ageRestricted
          ? 'age_reverification_required'
          : automationHoldActive
            ? 'moderation_automation_hold'
            : 'account_interaction_blocked',
      }
    );
  }

  const ageDecision = evaluateCanonicalAgeEligibility({
    uid,
    rawRecord: ageEligibilityRecord,
  });

  if (!ageDecision.allowed) {
    throw new HttpsError(
      ageDecision.denialReason === 'underage'
        ? 'permission-denied'
        : 'failed-precondition',
      ageDecision.denialReason === 'underage'
        ? 'O acesso adulto não está disponível para esta conta.'
        : 'Conclua a etapa de maioridade antes de realizar esta ação.',
      {
        reason: ageDecision.denialReason,
        recommendedAction: 'complete_age_verification',
      }
    );
  }

  if (!hasCurrentTerms(user.acceptedTerms)) {
    throw new HttpsError(
      'failed-precondition',
      'Aceite os termos vigentes antes de realizar esta ação.',
      {
        reason: 'terms_required',
        recommendedAction: 'accept_terms',
      }
    );
  }

  if (!hasCurrentAdultConsent(user.adultConsent)) {
    throw new HttpsError(
      'failed-precondition',
      'Aceite o acesso à experiência adulta antes de realizar esta ação.',
      {
        reason: 'adult_consent_required',
        recommendedAction: 'accept_adult_consent',
      }
    );
  }
}

export async function assertInteractionAccess(
  uid: string
): Promise<void> {
  const [userSnapshot, ageEligibilitySnapshot] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('age_eligibility_records').doc(uid).get(),
  ]);

  assertInteractionAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null,
    ageEligibilitySnapshot.exists
      ? ageEligibilitySnapshot.data()
      : null,
    uid
  );
}

export async function assertInteractionAccessInTransaction(
  transaction: Transaction,
  uid: string
): Promise<void> {
  const [userSnapshot, ageEligibilitySnapshot] = await Promise.all([
    transaction.get(db.collection('users').doc(uid)),
    transaction.get(db.collection('age_eligibility_records').doc(uid)),
  ]);

  assertInteractionAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null,
    ageEligibilitySnapshot.exists
      ? ageEligibilitySnapshot.data()
      : null,
    uid
  );
}
