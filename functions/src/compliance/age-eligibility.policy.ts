// functions/src/compliance/age-eligibility.policy.ts
// -----------------------------------------------------------------------------
// CANONICAL AGE ELIGIBILITY POLICY
// -----------------------------------------------------------------------------
// Decide se um registro backend-only autoriza acesso adulto.
// DECLARED_ADULT representa autodeclaração registrada pelo backend no modo
// operacional inicial; VERIFIED_ADULT continua reservado a prova forte.
// -----------------------------------------------------------------------------

import {
  AGE_ACCESS_ALLOWS_SELF_DECLARATION,
} from './age-access-policy.generated';

export const AGE_ELIGIBILITY_POLICY_VERSION = 1;

export type AgeEligibilityStatus =
  | 'UNVERIFIED'
  | 'DECLARED_ADULT'
  | 'REVIEW_REQUIRED'
  | 'VERIFIED_ADULT'
  | 'DENIED_UNDERAGE'
  | 'EXPIRED';

export type AgeEligibilitySource =
  | 'INITIAL_DECLARATION'
  | 'INITIAL_VERIFICATION'
  | 'AGE_REVERIFICATION'
  | 'PROFILE_KYC'
  | 'MIGRATION';

export type AgeEligibilityMethod =
  | 'SELF_DECLARATION'
  | 'EXTERNAL_PROVIDER'
  | 'MANUAL_REVIEW'
  | 'KYC'
  | 'MIGRATED_REVIEW';

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
  return normalized === 'INITIAL_DECLARATION' ||
    normalized === 'INITIAL_VERIFICATION' ||
    normalized === 'AGE_REVERIFICATION' ||
    normalized === 'PROFILE_KYC' ||
    normalized === 'MIGRATION'
    ? normalized
    : null;
}

function normalizeMethod(value: unknown): AgeEligibilityMethod | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'SELF_DECLARATION' ||
    normalized === 'EXTERNAL_PROVIDER' ||
    normalized === 'MANUAL_REVIEW' ||
    normalized === 'KYC' ||
    normalized === 'MIGRATED_REVIEW'
    ? normalized
    : null;
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
  const verifiedAtMs = record['verifiedAtMs'] === null
    ? null
    : positiveTime(record['verifiedAtMs']);
  const expiresAtMs = record['expiresAtMs'] === null
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

  const common = {
    policyVersion,
    source,
    method,
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
    const decidedAtMs = positiveTime(record['decidedAtMs']);

    if (
      !AGE_ACCESS_ALLOWS_SELF_DECLARATION ||
      source !== 'INITIAL_DECLARATION' ||
      method !== 'SELF_DECLARATION' ||
      decidedAtMs === null ||
      decidedAtMs > nowMs ||
      verifiedAtMs !== null ||
      (record['expiresAtMs'] !== null && expiresAtMs === null) ||
      (expiresAtMs !== null && expiresAtMs <= nowMs)
    ) {
      return denied('DECLARED_ADULT', 'verification_required', common);
    }

    return Object.freeze({
      allowed: true,
      status: 'DECLARED_ADULT' as const,
      denialReason: null,
      policyVersion,
      source,
      method,
      verifiedAtMs: null,
      expiresAtMs,
      caseId,
    });
  }

  if (status !== 'VERIFIED_ADULT') {
    return denied('UNVERIFIED', 'verification_required', common);
  }

  if (
    verifiedAtMs === null ||
    verifiedAtMs > nowMs ||
    (record['expiresAtMs'] !== null && expiresAtMs === null) ||
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
    verifiedAtMs,
    expiresAtMs,
    caseId,
  });
}
