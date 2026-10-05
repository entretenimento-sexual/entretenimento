import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  evaluateCanonicalAgeEligibility,
  isTrustedAdultAgeDecision,
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
}

export interface PlatformAccountAccessContext {
  readonly accessExpiresAtMs: number | null;
}

function cleanUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

function hasCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const terms = value as Record<string, unknown>;
  return terms['accepted'] === true &&
    String(terms['version'] ?? '').trim() === TERMS_ACCEPTANCE_VERSION &&
    terms['acknowledgedPrivacyNotice'] === true;
}

function hasCurrentAdultConsent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const consent = value as Record<string, unknown>;
  return consent['accepted'] === true &&
    String(consent['version'] ?? '').trim() === ADULT_CONSENT_VERSION;
}

export function assertPlatformAccountAccessData(
  user: InteractionAccessUserDocument | null | undefined
): void {
  if (!user) {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  const accountStatus = String(user.accountStatus ?? '')
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

export function assertTrustedAdultAccountAccessData(
  uid: string,
  rawAgeEligibility: unknown,
  nowMs = Date.now()
): PlatformAccountAccessContext {
  const decision = evaluateCanonicalAgeEligibility({
    uid,
    rawRecord: rawAgeEligibility,
    nowMs,
  });

  if (isTrustedAdultAgeDecision(decision)) {
    return { accessExpiresAtMs: decision.expiresAtMs };
  }

  const reason =
    decision.status === 'SELF_DECLARED_ADULT'
      ? 'verification_required'
      : decision.denialReason ?? 'verification_required';

  throw new HttpsError(
    reason === 'underage' ? 'permission-denied' : 'failed-precondition',
    reason === 'underage'
      ? 'O acesso adulto não está disponível para esta conta.'
      : 'Conclua a verificação confiável de maioridade para continuar.',
    {
      reason,
      recommendedAction:
        reason === 'review_required'
          ? 'complete_age_review'
          : 'complete_age_verification',
    }
  );
}

export async function assertInteractionAccess(
  uid: string
): Promise<PlatformAccountAccessContext> {
  const normalizedUid = cleanUid(uid);
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const [userSnapshot, ageSnapshot] = await db.getAll(
    db.collection('users').doc(normalizedUid),
    db.collection('age_eligibility_records').doc(normalizedUid)
  );

  assertPlatformAccountAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null
  );

  return assertTrustedAdultAccountAccessData(
    normalizedUid,
    ageSnapshot.exists ? ageSnapshot.data() : null
  );
}

export async function assertInteractionAccessInTransaction(
  transaction: Transaction,
  uid: string
): Promise<PlatformAccountAccessContext> {
  const normalizedUid = cleanUid(uid);
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const [userSnapshot, ageSnapshot] = await Promise.all([
    transaction.get(db.collection('users').doc(normalizedUid)),
    transaction.get(
      db.collection('age_eligibility_records').doc(normalizedUid)
    ),
  ]);

  assertPlatformAccountAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null
  );

  return assertTrustedAdultAccountAccessData(
    normalizedUid,
    ageSnapshot.exists ? ageSnapshot.data() : null
  );
}
