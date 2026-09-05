// functions/src/authority/verified-commercial-authority.policy.ts
// -----------------------------------------------------------------------------
// VERIFIED COMMERCIAL AUTHORITY POLICY
// -----------------------------------------------------------------------------
// Fonte canônica backend-only para validar a identidade comercial verificada
// que pode exercer autoridade sobre recursos da plataforma. Capacidades de um
// domínio específico (ex.: criar Espaço Oficial) não pertencem a esta policy.
// -----------------------------------------------------------------------------

export type VerifiedCommercialAuthorityDenialReason =
  | 'authority_missing'
  | 'verification_required'
  | 'authority_mismatch'
  | 'authority_inactive';

export interface VerifiedCommercialAuthorityDecision {
  readonly allowed: boolean;
  readonly holderUid: string | null;
  readonly organizationId: string | null;
  readonly denialReason: VerifiedCommercialAuthorityDenialReason | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function finiteEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function denied(
  denialReason: VerifiedCommercialAuthorityDenialReason,
  holderUid: string | null = null,
  organizationId: string | null = null
): Readonly<VerifiedCommercialAuthorityDecision> {
  return Object.freeze({
    allowed: false,
    holderUid,
    organizationId,
    denialReason,
  });
}

export function evaluateVerifiedCommercialAuthority(input: {
  readonly actorUid: string;
  readonly rawGrant: unknown;
  readonly now?: number;
}): Readonly<VerifiedCommercialAuthorityDecision> {
  const actorUid = cleanId(input.actorUid);
  if (!actorUid || !isRecord(input.rawGrant)) {
    return denied('authority_missing');
  }

  const grant = input.rawGrant;
  const holderUid = cleanId(grant['holderUid']);
  const organizationId = cleanId(grant['organizationId']);

  if (!holderUid || holderUid !== actorUid || !organizationId) {
    return denied('authority_mismatch', holderUid, organizationId);
  }

  if (grant['verificationStatus'] !== 'verified') {
    return denied('verification_required', holderUid, organizationId);
  }

  const startsAt = finiteEpoch(grant['startsAt']);
  const rawEndsAt = grant['endsAt'];
  const endsAt = rawEndsAt === null ? null : finiteEpoch(rawEndsAt);
  const now = input.now ?? Date.now();
  const validTimeWindow =
    startsAt !== null
    && startsAt <= now
    && (rawEndsAt === null || (endsAt !== null && endsAt > now));

  if (grant['active'] !== true || !validTimeWindow) {
    return denied('authority_inactive', holderUid, organizationId);
  }

  return Object.freeze({
    allowed: true,
    holderUid,
    organizationId,
    denialReason: null,
  });
}
