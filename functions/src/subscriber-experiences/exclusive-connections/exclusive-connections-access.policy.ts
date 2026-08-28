// functions/src/subscriber-experiences/exclusive-connections/exclusive-connections-access.policy.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS BACKEND ACCESS POLICY
// -----------------------------------------------------------------------------
// Espelha no backend os requisitos não financeiros declarados pela interface.
// O entitlement é validado separadamente pela camada de billing.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

export type ExclusiveConnectionsEligibilityReason =
  | 'profile_missing'
  | 'account_restricted'
  | 'adult_access_required'
  | 'profile_incomplete'
  | 'profile_field_missing';

export interface ExclusiveConnectionsEligibilityDecision {
  allowed: boolean;
  reason: ExclusiveConnectionsEligibilityReason | null;
}

const AGE_REVERIFICATION_RESTRICTED_STATES = new Set([
  'REQUIRED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'REJECTED',
  'EXPIRED',
]);

const REQUIRED_PROFILE_FIELDS = [
  'gender',
  'orientation',
  'estado',
  'municipio',
] as const;

function hasTextField(
  user: Record<string, unknown>,
  field: (typeof REQUIRED_PROFILE_FIELDS)[number]
): boolean {
  return typeof user[field] === 'string'
    && String(user[field]).trim().length > 0;
}

function hasAdultAccess(user: Record<string, unknown>): boolean {
  const idade = user['idade'];
  const adultConsent = (user['adultConsent'] ?? {}) as Record<string, unknown>;
  const ageReverification = (user['ageReverification'] ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof idade === 'number' && idade < 18) {
    return false;
  }

  if (ageReverification['result'] === 'UNDERAGE') {
    return false;
  }

  if (
    AGE_REVERIFICATION_RESTRICTED_STATES.has(
      String(ageReverification['status'] ?? '').trim().toUpperCase()
    )
  ) {
    return false;
  }

  if (adultConsent['accepted'] === false) {
    return false;
  }

  if (
    user['initialAdultConsentRequired'] === true
    && adultConsent['accepted'] !== true
  ) {
    return false;
  }

  return true;
}

export function evaluateExclusiveConnectionsEligibility(
  rawUser: unknown,
  expectedUid: string
): ExclusiveConnectionsEligibilityDecision {
  const user = (rawUser ?? {}) as Record<string, unknown>;

  if (user['uid'] !== expectedUid) {
    return { allowed: false, reason: 'profile_missing' };
  }

  const accountStatus = String(user['accountStatus'] ?? 'active')
    .trim()
    .toLowerCase();

  if (
    accountStatus !== 'active'
    || user['suspended'] === true
    || user['interactionBlocked'] === true
    || user['accountLocked'] === true
    || user['loginAllowed'] === false
  ) {
    return { allowed: false, reason: 'account_restricted' };
  }

  if (!hasAdultAccess(user)) {
    return { allowed: false, reason: 'adult_access_required' };
  }

  if (user['profileCompleted'] !== true) {
    return { allowed: false, reason: 'profile_incomplete' };
  }

  if (REQUIRED_PROFILE_FIELDS.some((field) => !hasTextField(user, field))) {
    return { allowed: false, reason: 'profile_field_missing' };
  }

  return { allowed: true, reason: null };
}

export function assertExclusiveConnectionsEligibility(
  rawUser: unknown,
  expectedUid: string
): void {
  const decision = evaluateExclusiveConnectionsEligibility(
    rawUser,
    expectedUid
  );

  if (decision.allowed) {
    return;
  }

  switch (decision.reason) {
  case 'profile_missing':
    throw new HttpsError('not-found', 'Perfil não localizado.');

  case 'account_restricted':
    throw new HttpsError(
      'permission-denied',
      'Sua conta não está disponível para esta experiência.'
    );

  case 'adult_access_required':
    throw new HttpsError(
      'failed-precondition',
      'Confirmação de acesso adulto necessária.'
    );

  case 'profile_incomplete':
  case 'profile_field_missing':
  default:
    throw new HttpsError(
      'failed-precondition',
      'Complete seu perfil para continuar.'
    );
  }
}
