// functions/src/compliance/age-eligibility.policy.ts
// -----------------------------------------------------------------------------
// CANONICAL AGE ELIGIBILITY POLICY
// -----------------------------------------------------------------------------
// age_eligibility_records/{uid} permanece backend-only.
//
// O modelo separa explicitamente:
// - DECLARED_ADULT / SELF_ATTESTED: autodeclaração aceita no estágio atual;
// - VERIFIED_ADULT / VERIFIED: prova forte por provedor, KYC ou revisão.
//
// Assim a plataforma pode operar sem fingir que autodeclaração é verificação e
// pode endurecer a política futuramente sem reescrever o domínio.
// -----------------------------------------------------------------------------

export const AGE_ELIGIBILITY_POLICY_VERSION = 1;

export type AgeAccessPolicyMode =
  | 'SELF_ATTESTATION_ALLOWED'
  | 'VERIFIED_ONLY';

export const AGE_ACCESS_POLICY_MODE: AgeAccessPolicyMode =
  'SELF_ATTESTATION_ALLOWED';

export type AgeEligibilityStatus =
  | 'UNVERIFIED'
  | 'DECLARED_ADULT'
  | 'REVIEW_REQUIRED'
  | 'VERIFIED_ADULT'
  | 'DENIED_UNDERAGE'
  | 'EXPIRED';

export type AgeEligibilitySource =
  | 'SELF_ATTESTATION'
  | 'INITIAL_VERIFICATION'
  | 'AGE_REVERIFICATION'
  | 'PROFILE_KYC'
  | 'MIGRATION';

export type AgeEligibilityMethod =
  | 'SELF_ATTESTATION'
  | 'EXTERNAL_PROVIDER'
  | 'MANUAL_REVIEW'
  | 'KYC'
  | 'MIGRATED_REVIEW';

export type AgeEligibilityAssuranceLevel =
  | 'NONE'
  | 'SELF_ATTESTED'
  | 'VERIFIED';

export type AgeEligibilityDenialReason =
  | 'verification_required'
  | 'review_required'
  | 'verification_expired'
  | 'underage'
  | 'record_mismatch'
  | 'policy_outdated';

export interface CanonicalAgeEligibilityRecord {
  uid: string;
  status: AgeEligibilityStatus;
  policyVersion: number;
  source: AgeEligibilitySource;
  method: AgeEligibilityMethod;
  assuranceLevel: AgeEligibilityAssuranceLevel;
  caseId: string | null;
  verifiedAtMs: number | null;
  decidedAtMs: number;
  expiresAtMs: number | null;
  updatedAtMs: number;
}

export interface AgeEligibilityDecision {
  allowed: boolean;
  status: AgeEligibilityStatus;
  denialReason: AgeEligibilityDenialReason | null;
  policyVersion: number | null;
  source: AgeEligibilitySource | null;
  method: AgeEligibilityMethod | null;
  assuranceLevel: AgeEligibilityAssuranceLevel | null;
  verifiedAtMs: number | null;
  expiresAtMs: number | null;
  caseId: string | null;
}

function cleanUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanCaseId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return !normalized || /^[A-Za-z0-9_-]{1,128}$/.test(normalized)
    ? normalized || null
    : null;
}

function positiveTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeStatus(value: unknown): AgeEligibilityStatus | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'UNVERIFIED' ||
    normalized === 'DECLARED_ADULT' ||
    normalized === 'REVIEW_REQUIRED' ||
    normalized === 'VERIFIED_ADULT' ||
    normalized === 'DENIED_UNDERAGE' ||
    normalized === 'EXPIRED'
    ? normalized
    : null;
}

function normalizeSource(value: unknown): AgeEligibilitySource | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'SELF_ATTESTATION' ||
    normalized === 'INITIAL_VERIFICATION' ||
    normalized === 'AGE_REVERIFICATION' ||
    normalized === 'PROFILE_KYC' ||
    normalized === 'MIGRATION'
    ? normalized
    : null;
}

function normalizeMethod(value: unknown): AgeEligibilityMethod | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'SELF_ATTESTATION' ||
    normalized === 'EXTERNAL_PROVIDER' ||
    normalized === 'MANUAL_REVIEW' ||
    normalized === 'KYC' ||
    normalized === 'MIGRATED_REVIEW'
    ? normalized
    : null;
}

function normalizeAssurance(
  value: unknown
): AgeEligibilityAssuranceLevel | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'NONE' ||
    normalized === 'SELF_ATTESTED' ||
    normalized === 'VERIFIED'
    ? normalized
    : null;
}

function expectedAssurance(
  status: AgeEligibilityStatus,
  method: AgeEligibilityMethod
): AgeEligibilityAssuranceLevel {
  if (
    status === 'DECLARED_ADULT' &&
    method === 'SELF_ATTESTATION'
  ) {
    return 'SELF_ATTESTED';
  }

  if (
    status === 'VERIFIED_ADULT' &&
    method !== 'SELF_ATTESTATION'
  ) {
    return 'VERIFIED';
  }

  return 'NONE';
}

function denied(
  status: AgeEligibilityStatus,
  denialReason: AgeEligibilityDenialReason,
  input: Partial<AgeEligibilityDecision> = {}
): Readonly<AgeEligibilityDecision> {
  return Object.freeze({
    allowed: false,
    status,
    denialReason,
    policyVersion: input.policyVersion ?? null,
    source: input.source ?? null,
    method: input.method ?? null,
    assuranceLevel: input.assuranceLevel ?? null,
    verifiedAtMs: input.verifiedAtMs ?? null,
    expiresAtMs: input.expiresAtMs ?? null,
    caseId: input.caseId ?? null,
  });
}

export function evaluateCanonicalAgeEligibility(input: {
  uid: string;
  rawRecord: unknown;
  nowMs?: number;
}): Readonly<AgeEligibilityDecision> {
  const expectedUid = cleanUid(input.uid);
  const nowMs = positiveTime(input.nowMs ?? Date.now()) ?? Date.now();

  if (
    !expectedUid ||
    !input.rawRecord ||
    typeof input.rawRecord !== 'object' ||
    Array.isArray(input.rawRecord)
  ) {
    return denied('UNVERIFIED', 'verification_required');
  }

  const record = input.rawRecord as Record<string, unknown>;
  const uid = cleanUid(record['uid']);
  const status = normalizeStatus(record['status']);
  const source = normalizeSource(record['source']);
  const method = normalizeMethod(record['method']);
  const caseId = cleanCaseId(record['caseId']);
  const policyVersion = Number(record['policyVersion']);
  const verifiedAtMs = record['verifiedAtMs'] == null
    ? null
    : positiveTime(record['verifiedAtMs']);
  const decidedAtMs = positiveTime(record['decidedAtMs']);
  const expiresAtMs = record['expiresAtMs'] == null
    ? null
    : positiveTime(record['expiresAtMs']);

  if (
    uid !== expectedUid ||
    !status ||
    !source ||
    !method ||
    !Number.isInteger(policyVersion) ||
    policyVersion < 1
  ) {
    return denied(status ?? 'UNVERIFIED', 'record_mismatch');
  }

  const derivedAssurance = expectedAssurance(status, method);
  const storedAssurance = normalizeAssurance(record['assuranceLevel']);
  const assuranceLevel = storedAssurance ?? derivedAssurance;
  const common = {
    policyVersion,
    source,
    method,
    assuranceLevel,
    verifiedAtMs,
    expiresAtMs,
    caseId,
  };

  if (policyVersion !== AGE_ELIGIBILITY_POLICY_VERSION) {
    return denied(status, 'policy_outdated', common);
  }

  if (status === 'DENIED_UNDERAGE') {
    return denied(status, 'underage', common);
  }

  if (status === 'REVIEW_REQUIRED') {
    return denied(status, 'review_required', common);
  }

  if (status === 'EXPIRED') {
    return denied(status, 'verification_expired', common);
  }

  if (status === 'DECLARED_ADULT') {
    if (
      AGE_ACCESS_POLICY_MODE !== 'SELF_ATTESTATION_ALLOWED' ||
      source !== 'SELF_ATTESTATION' ||
      method !== 'SELF_ATTESTATION' ||
      assuranceLevel !== 'SELF_ATTESTED' ||
      decidedAtMs === null ||
      decidedAtMs > nowMs
    ) {
      return denied(status, 'record_mismatch', common);
    }

    return Object.freeze({
      allowed: true,
      status,
      denialReason: null,
      policyVersion,
      source,
      method,
      assuranceLevel: 'SELF_ATTESTED',
      verifiedAtMs: null,
      expiresAtMs: null,
      caseId,
    });
  }

  if (status !== 'VERIFIED_ADULT') {
    return denied('UNVERIFIED', 'verification_required', common);
  }

  if (
    method === 'SELF_ATTESTATION' ||
    assuranceLevel !== 'VERIFIED' ||
    verifiedAtMs === null ||
    verifiedAtMs > nowMs ||
    (record['expiresAtMs'] != null && expiresAtMs === null) ||
    (expiresAtMs !== null && expiresAtMs <= nowMs)
  ) {
    return denied('EXPIRED', 'verification_expired', common);
  }

  return Object.freeze({
    allowed: true,
    status: 'VERIFIED_ADULT',
    denialReason: null,
    policyVersion,
    source,
    method,
    assuranceLevel: 'VERIFIED',
    verifiedAtMs,
    expiresAtMs,
    caseId,
  });
}
