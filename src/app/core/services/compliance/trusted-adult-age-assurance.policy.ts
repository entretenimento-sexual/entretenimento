import type { IUserAgeEligibility } from '@core/interfaces/iuser-dados';

export const TRUSTED_ADULT_AGE_POLICY_VERSION = 1;

const TRUSTED_ADULT_SOURCES = new Set([
  'INITIAL_VERIFICATION',
  'AGE_REVERIFICATION',
  'PROFILE_KYC',
  'MIGRATION',
]);

const TRUSTED_ADULT_METHODS = new Set([
  'EXTERNAL_PROVIDER',
  'MANUAL_REVIEW',
  'KYC',
  'MIGRATED_REVIEW',
]);

export interface TrustedAdultAgeProjectionDecision {
  readonly allowed: boolean;
  readonly accessExpiresAtMs: number | null;
}

function positiveEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : null;
}

export function resolveTrustedAdultAgeProjection(
  state: IUserAgeEligibility | null | undefined,
  nowMs = Date.now()
): TrustedAdultAgeProjectionDecision {
  if (!state) {
    return { allowed: false, accessExpiresAtMs: null };
  }

  const verifiedAtMs = positiveEpoch(state.verifiedAtMs);
  const rawExpiresAtMs = state.expiresAtMs;
  const expiresAtMs = rawExpiresAtMs == null
    ? null
    : positiveEpoch(rawExpiresAtMs);
  const source = String(state.source ?? '').trim().toUpperCase();
  const method = String(state.method ?? '').trim().toUpperCase();

  const allowed =
    state.status === 'VERIFIED_ADULT' &&
    Number(state.policyVersion) === TRUSTED_ADULT_AGE_POLICY_VERSION &&
    TRUSTED_ADULT_SOURCES.has(source) &&
    TRUSTED_ADULT_METHODS.has(method) &&
    verifiedAtMs !== null &&
    verifiedAtMs <= nowMs &&
    (rawExpiresAtMs == null ||
      (expiresAtMs !== null && expiresAtMs > nowMs));

  return {
    allowed,
    accessExpiresAtMs: allowed ? expiresAtMs : null,
  };
}

export function isCurrentTrustedAdultAgeProjection(
  state: IUserAgeEligibility | null | undefined,
  nowMs = Date.now()
): boolean {
  return resolveTrustedAdultAgeProjection(state, nowMs).allowed;
}
