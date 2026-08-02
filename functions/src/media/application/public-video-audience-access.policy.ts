// functions/src/media/application/public-video-audience-access.policy.ts
// -----------------------------------------------------------------------------
// PUBLIC VIDEO AUDIENCE ACCESS POLICY
// -----------------------------------------------------------------------------
// Política pura e determinística. A UI pode antecipar o estado, mas a decisão
// definitiva permanece no backend antes da emissão ou renovação de URLs.
// -----------------------------------------------------------------------------

export type PublicVideoAccountDenialReason =
  | 'profile_missing'
  | 'account_restricted'
  | 'email_unverified'
  | 'adult_access_required'
  | 'terms_required'
  | 'profile_incomplete';

export interface PublicVideoAccountEligibilityDecision {
  readonly allowed: boolean;
  readonly reason: PublicVideoAccountDenialReason | null;
}

export interface PublicVideoAccountEligibilityOptions {
  /** Claim do Firebase Auth; evita depender somente da projeção no Firestore. */
  readonly authenticatedEmailVerified?: boolean;
  /** Perfis autores legados podem não possuir a projeção de e-mail atualizada. */
  readonly requireVerifiedEmail?: boolean;
  readonly requireCompletedProfile?: boolean;
}

const AGE_REVERIFICATION_RESTRICTED_STATES = new Set([
  'REQUIRED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'REJECTED',
  'EXPIRED',
]);

function nestedRecord(
  value: unknown
): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function normalizedAccountStatus(
  user: Readonly<Record<string, unknown>>
): string {
  return String(user['accountStatus'] ?? 'active').trim().toLowerCase();
}

function hasAdultAccess(
  user: Readonly<Record<string, unknown>>
): boolean {
  const declaredAge = user['idade'] ?? user['age'];
  const adultConsent = nestedRecord(user['adultConsent']);
  const ageReverification = nestedRecord(user['ageReverification']);

  if (
    typeof declaredAge === 'number'
    && Number.isFinite(declaredAge)
    && declaredAge < 18
  ) {
    return false;
  }

  if (
    String(ageReverification['result'] ?? '').trim().toUpperCase()
    === 'UNDERAGE'
  ) {
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

function hasRequiredTerms(
  user: Readonly<Record<string, unknown>>
): boolean {
  const acceptedTerms = nestedRecord(user['acceptedTerms']);

  if (acceptedTerms['accepted'] === false) {
    return false;
  }

  if (acceptedTerms['adultAccessAcknowledgement'] === false) {
    return false;
  }

  // Contas criadas no fluxo versionado devem possuir aceite explícito.
  // Contas legadas continuam elegíveis até a migração administrativa.
  if (
    user['initialAdultConsentRequired'] === true
    && acceptedTerms['accepted'] !== true
  ) {
    return false;
  }

  return true;
}

export function evaluatePublicVideoAccountEligibility(
  rawUser: unknown,
  expectedUid: string,
  options: PublicVideoAccountEligibilityOptions = {}
): PublicVideoAccountEligibilityDecision {
  const user = nestedRecord(rawUser);
  const requireVerifiedEmail = options.requireVerifiedEmail !== false;
  const requireCompletedProfile = options.requireCompletedProfile !== false;

  if (String(user['uid'] ?? '').trim() !== expectedUid) {
    return { allowed: false, reason: 'profile_missing' };
  }

  if (
    normalizedAccountStatus(user) !== 'active'
    || user['suspended'] === true
    || user['interactionBlocked'] === true
    || user['accountLocked'] === true
    || user['loginAllowed'] === false
  ) {
    return { allowed: false, reason: 'account_restricted' };
  }

  if (
    requireVerifiedEmail
    && options.authenticatedEmailVerified !== true
    && user['emailVerified'] !== true
  ) {
    return { allowed: false, reason: 'email_unverified' };
  }

  if (!hasAdultAccess(user)) {
    return { allowed: false, reason: 'adult_access_required' };
  }

  if (!hasRequiredTerms(user)) {
    return { allowed: false, reason: 'terms_required' };
  }

  if (requireCompletedProfile && user['profileCompleted'] !== true) {
    return { allowed: false, reason: 'profile_incomplete' };
  }

  return { allowed: true, reason: null };
}

export function isActiveUserBlock(rawBlock: unknown): boolean {
  const block = nestedRecord(rawBlock);
  return block['isBlocked'] === true;
}
