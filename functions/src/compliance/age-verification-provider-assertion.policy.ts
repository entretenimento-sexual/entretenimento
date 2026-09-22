// functions/src/compliance/age-verification-provider-assertion.policy.ts
// -----------------------------------------------------------------------------
// TRUSTED AGE PROVIDER ASSERTION
// -----------------------------------------------------------------------------
// Contrato mínimo para resultado vindo de integração backend confiável.
// Não aceita documento, imagem ou data de nascimento.
// -----------------------------------------------------------------------------

export type ProviderAgeAssertionResult =
  | 'VERIFIED_ADULT'
  | 'DENIED_UNDERAGE';

export type ProviderAgeAssuranceLevel =
  | 'SUBSTANTIAL'
  | 'HIGH';

export interface ProviderAgeAssertion {
  assertionId: string;
  uid: string;
  provider: string;
  result: ProviderAgeAssertionResult;
  assuranceLevel: ProviderAgeAssuranceLevel;
  verifiedAtMs: number;
  expiresAtMs: number | null;
  providerReferenceHash: string;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,180}$/.test(normalized) ? normalized : '';
}

function cleanProvider(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9._-]{2,80}$/.test(normalized) ? normalized : '';
}

function positiveTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function normalizeProviderAgeAssertion(input: {
  assertionId: unknown;
  raw: unknown;
  nowMs?: number;
}): ProviderAgeAssertion | null {
  if (!input.raw || typeof input.raw !== 'object' || Array.isArray(input.raw)) {
    return null;
  }

  const raw = input.raw as Record<string, unknown>;
  const assertionId = cleanId(input.assertionId);
  const uid = cleanId(raw['uid']);
  const provider = cleanProvider(raw['provider']);
  const result = String(raw['result'] ?? '').trim().toUpperCase();
  const assuranceLevel = String(
    raw['assuranceLevel'] ?? ''
  ).trim().toUpperCase();
  const verifiedAtMs = positiveTime(raw['verifiedAtMs']);
  const expiresAtMs = raw['expiresAtMs'] == null
    ? null
    : positiveTime(raw['expiresAtMs']);
  const providerReferenceHash = String(
    raw['providerReferenceHash'] ?? ''
  ).trim().toLowerCase();
  const nowMs = positiveTime(input.nowMs ?? Date.now()) ?? Date.now();

  if (
    !assertionId ||
    !uid ||
    !provider ||
    (result !== 'VERIFIED_ADULT' && result !== 'DENIED_UNDERAGE') ||
    (assuranceLevel !== 'SUBSTANTIAL' && assuranceLevel !== 'HIGH') ||
    verifiedAtMs === null ||
    verifiedAtMs > nowMs + 5 * 60_000 ||
    (raw['expiresAtMs'] != null && expiresAtMs === null) ||
    (expiresAtMs !== null && expiresAtMs <= verifiedAtMs) ||
    !/^[a-f0-9]{64}$/.test(providerReferenceHash)
  ) {
    return null;
  }

  return {
    assertionId,
    uid,
    provider,
    result,
    assuranceLevel,
    verifiedAtMs,
    expiresAtMs,
    providerReferenceHash,
  };
}

export function resolveProviderAssertionCanonicalStatus(input: {
  currentStatus: unknown;
  assertionResult: ProviderAgeAssertionResult;
}): 'VERIFIED_ADULT' | 'DENIED_UNDERAGE' | 'REVIEW_REQUIRED' {
  const currentStatus = String(input.currentStatus ?? '')
    .trim()
    .toUpperCase();

  if (
    currentStatus === 'VERIFIED_ADULT' &&
    input.assertionResult === 'DENIED_UNDERAGE'
  ) {
    return 'REVIEW_REQUIRED';
  }

  if (
    currentStatus === 'DENIED_UNDERAGE' &&
    input.assertionResult === 'VERIFIED_ADULT'
  ) {
    return 'REVIEW_REQUIRED';
  }

  return input.assertionResult;
}
