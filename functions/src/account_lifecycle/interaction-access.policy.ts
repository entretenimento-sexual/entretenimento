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

/**
 * Autoridade canônica de acesso da conta às superfícies normais da plataforma.
 *
 * Maioridade é decidida no domínio da conta. SELF_DECLARED_ADULT e
 * VERIFIED_ADULT são níveis de assurance dessa decisão e não gates que cada
 * feature deve reavaliar. Evidência posterior de menoridade precisa primeiro
 * produzir uma consequência de lifecycle da conta.
 */
export function assertPlatformAccountAccessData(
  user: InteractionAccessUserDocument | null | undefined
): void {
  if (!user) {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();
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
    automationHoldActive
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Esta conta não pode realizar interações no momento.',
      {
        reason: automationHoldActive
          ? 'moderation_automation_hold'
          : 'account_interaction_blocked',
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
