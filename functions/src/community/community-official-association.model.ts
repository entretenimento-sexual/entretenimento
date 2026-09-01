// functions/src/community/community-official-association.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL ASSOCIATION
// -----------------------------------------------------------------------------
// Fonte canônica backend-only que vincula uma Comunidade a uma entidade oficial.
//
// Responsabilidades separadas:
// - grants/entitlements respondem quem pode criar ou administrar em nome de uma
//   organização;
// - esta associação responde qual entidade canônica a Comunidade representa;
// - projeções públicas recebem apenas alvo + estado verificado, sem organização,
//   UID do responsável, evidência de KYC/KYB ou trilha interna de verificação.
// -----------------------------------------------------------------------------

export const COMMUNITY_OFFICIAL_ASSOCIATION_POLICY_VERSION = 1;

export const COMMUNITY_OFFICIAL_TARGET_TYPES = [
  'profile',
  'organization',
  'venue',
  'event',
] as const;

export type CommunityOfficialTargetType =
  typeof COMMUNITY_OFFICIAL_TARGET_TYPES[number];

export type CommunityOfficialAssociationStatus = 'verified' | 'revoked';

export type CommunityOfficialAuthorityRole =
  | 'self'
  | 'owner'
  | 'authorized_representative'
  | 'manager'
  | 'organizer'
  | 'promoter';

export type CommunityOfficialVerificationSource =
  | 'profile_verification'
  | 'organization_verification'
  | 'official_space_creation_grant'
  | 'event_authorization'
  | 'platform_review';

export interface CommunityOfficialTarget {
  type: CommunityOfficialTargetType;
  id: string;
}

export interface CommunityOfficialAssociationRecord {
  associationKey: string;
  communityId: string;
  target: CommunityOfficialTarget;
  status: CommunityOfficialAssociationStatus;
  /** Contexto comercial privado. Nunca deve ir para projeção pública. */
  sponsorOrganizationId: string | null;
  authority: {
    holderUid: string;
    role: CommunityOfficialAuthorityRole;
  };
  verification: {
    source: CommunityOfficialVerificationSource;
    policyVersion: number;
    verifiedAt: number;
  };
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CommunityOfficialAssociationPublicProjection {
  target: CommunityOfficialTarget;
  verified: true;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_ASSOCIATION_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeCommunityOfficialAssociationKey(
  value: unknown
): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ASSOCIATION_KEY_PATTERN.test(normalized) ? normalized : null;
}

function normalizeTargetType(
  value: unknown
): CommunityOfficialTargetType | null {
  return value === 'profile'
    || value === 'organization'
    || value === 'venue'
    || value === 'event'
    ? value
    : null;
}

function normalizePublicTarget(raw: unknown): CommunityOfficialTarget | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const type = normalizeTargetType(source['type']);
  const id = normalizeSafeId(source['id']);
  return type && id ? { type, id } : null;
}

export function buildCommunityOfficialAssociationKey(
  target: Readonly<CommunityOfficialTarget>
): string | null {
  const type = normalizeTargetType(target.type);
  const id = normalizeSafeId(target.id);
  if (!type || !id) return null;

  return normalizeCommunityOfficialAssociationKey(`${type}:${id}`);
}

export function buildVerifiedVenueOfficialAssociation(input: {
  venueId: string;
  communityId: string;
  sponsorOrganizationId: string;
  holderUid: string;
  verifiedAt: number;
  verificationPolicyVersion: number;
}): Readonly<CommunityOfficialAssociationRecord> | null {
  const venueId = normalizeSafeId(input.venueId);
  const communityId = normalizeSafeId(input.communityId);
  const sponsorOrganizationId = normalizeSafeId(input.sponsorOrganizationId);
  const holderUid = normalizeSafeId(input.holderUid);
  const verifiedAt = Number(input.verifiedAt);
  const verificationPolicyVersion = Number(input.verificationPolicyVersion);

  if (
    !venueId
    || !communityId
    || !sponsorOrganizationId
    || !holderUid
    || !Number.isFinite(verifiedAt)
    || verifiedAt <= 0
    || !Number.isInteger(verificationPolicyVersion)
    || verificationPolicyVersion <= 0
  ) {
    return null;
  }

  const target: CommunityOfficialTarget = { type: 'venue', id: venueId };
  const associationKey = buildCommunityOfficialAssociationKey(target);
  if (!associationKey) return null;

  return Object.freeze({
    associationKey,
    communityId,
    target,
    status: 'verified',
    sponsorOrganizationId,
    authority: {
      holderUid,
      role: 'authorized_representative',
    },
    verification: {
      source: 'official_space_creation_grant',
      policyVersion: verificationPolicyVersion,
      verifiedAt: Math.trunc(verifiedAt),
    },
    revokedAt: null,
    createdAt: Math.trunc(verifiedAt),
    updatedAt: Math.trunc(verifiedAt),
  });
}

/** Normaliza somente a projeção já sanitizada destinada a UI/Discovery. */
export function normalizeCommunityOfficialAssociationPublicProjection(
  raw: unknown
): CommunityOfficialAssociationPublicProjection | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const target = normalizePublicTarget(source['target']);

  if (!target || source['verified'] !== true) return null;

  return {
    target,
    verified: true,
  };
}

/**
 * Converte o registro privado em projeção segura para UI/Discovery.
 * Qualquer inconsistência ou estado não verificado resulta em ausência de selo.
 */
export function sanitizeCommunityOfficialAssociationPublicProjection(
  raw: unknown
): CommunityOfficialAssociationPublicProjection | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (source['status'] !== 'verified') return null;

  const target = normalizePublicTarget(source['target']);
  const communityId = normalizeSafeId(source['communityId']);
  const associationKey = normalizeCommunityOfficialAssociationKey(
    source['associationKey']
  );

  if (!target || !communityId || !associationKey) return null;

  const expectedKey = buildCommunityOfficialAssociationKey(target);
  if (expectedKey !== associationKey) return null;

  return {
    target,
    verified: true,
  };
}
