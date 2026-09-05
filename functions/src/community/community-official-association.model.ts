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
    revalidationDueAt: number | null;
    expiresAt: number | null;
  };
  /** Campos operacionais privados usados pelo lifecycle automático. */
  activeRevalidationDueAt: number | null;
  activeVerificationExpiresAt: number | null;
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

function normalizeAuthorityRole(
  value: unknown
): CommunityOfficialAuthorityRole | null {
  return value === 'self'
    || value === 'owner'
    || value === 'authorized_representative'
    || value === 'manager'
    || value === 'organizer'
    || value === 'promoter'
    ? value
    : null;
}

function normalizeVerificationSource(
  value: unknown
): CommunityOfficialVerificationSource | null {
  return value === 'profile_verification'
    || value === 'organization_verification'
    || value === 'official_space_creation_grant'
    || value === 'event_authorization'
    || value === 'platform_review'
    ? value
    : null;
}

function normalizePublicTarget(raw: unknown): CommunityOfficialTarget | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const type = normalizeTargetType(source['type']);
  const id = normalizeSafeId(source['id']);
  return type && id ? { type, id } : null;
}

function normalizeOptionalFutureEpoch(
  value: unknown,
  verifiedAt: number
): number | null | undefined {
  if (value === null || value === undefined) return null;

  const normalized = Math.trunc(Number(value));
  if (!Number.isFinite(normalized) || normalized <= verifiedAt) {
    return undefined;
  }

  return normalized;
}

export function buildCommunityOfficialAssociationKey(
  target: Readonly<CommunityOfficialTarget>
): string | null {
  const type = normalizeTargetType(target.type);
  const id = normalizeSafeId(target.id);
  if (!type || !id) return null;

  return normalizeCommunityOfficialAssociationKey(`${type}:${id}`);
}

export function buildVerifiedCommunityOfficialAssociation(input: {
  target: CommunityOfficialTarget;
  communityId: string;
  sponsorOrganizationId: string | null;
  holderUid: string;
  authorityRole: CommunityOfficialAuthorityRole;
  verificationSource: CommunityOfficialVerificationSource;
  verifiedAt: number;
  verificationPolicyVersion: number;
  revalidationDueAt?: number | null;
  verificationExpiresAt?: number | null;
  createdAt?: number;
}): Readonly<CommunityOfficialAssociationRecord> | null {
  const target = normalizePublicTarget(input.target);
  const communityId = normalizeSafeId(input.communityId);
  const holderUid = normalizeSafeId(input.holderUid);
  const authorityRole = normalizeAuthorityRole(input.authorityRole);
  const verificationSource = normalizeVerificationSource(
    input.verificationSource
  );
  const sponsorOrganizationId = input.sponsorOrganizationId === null
    ? null
    : normalizeSafeId(input.sponsorOrganizationId);
  const verifiedAt = Math.trunc(Number(input.verifiedAt));
  const policyVersion = Math.trunc(Number(input.verificationPolicyVersion));
  const createdAt = input.createdAt === undefined
    ? verifiedAt
    : Math.trunc(Number(input.createdAt));

  if (
    !target
    || !communityId
    || !holderUid
    || !authorityRole
    || !verificationSource
    || (input.sponsorOrganizationId !== null && !sponsorOrganizationId)
    || !Number.isFinite(verifiedAt)
    || verifiedAt <= 0
    || !Number.isInteger(policyVersion)
    || policyVersion <= 0
    || !Number.isFinite(createdAt)
    || createdAt <= 0
    || createdAt > verifiedAt
  ) {
    return null;
  }

  const revalidationDueAt = normalizeOptionalFutureEpoch(
    input.revalidationDueAt,
    verifiedAt
  );
  const verificationExpiresAt = normalizeOptionalFutureEpoch(
    input.verificationExpiresAt,
    verifiedAt
  );

  if (
    revalidationDueAt === undefined
    || verificationExpiresAt === undefined
    || (
      revalidationDueAt !== null
      && verificationExpiresAt !== null
      && revalidationDueAt >= verificationExpiresAt
    )
  ) {
    return null;
  }

  const associationKey = buildCommunityOfficialAssociationKey(target);
  if (!associationKey) return null;

  const association: CommunityOfficialAssociationRecord = {
    associationKey,
    communityId,
    target,
    status: 'verified',
    sponsorOrganizationId,
    authority: {
      holderUid,
      role: authorityRole,
    },
    verification: {
      source: verificationSource,
      policyVersion,
      verifiedAt,
      revalidationDueAt,
      expiresAt: verificationExpiresAt,
    },
    activeRevalidationDueAt: revalidationDueAt,
    activeVerificationExpiresAt: verificationExpiresAt,
    revokedAt: null,
    createdAt,
    updatedAt: verifiedAt,
  };

  return Object.freeze(association);
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
  if (!venueId) return null;

  return buildVerifiedCommunityOfficialAssociation({
    target: { type: 'venue', id: venueId },
    communityId: input.communityId,
    sponsorOrganizationId: input.sponsorOrganizationId,
    holderUid: input.holderUid,
    authorityRole: 'authorized_representative',
    verificationSource: 'official_space_creation_grant',
    verifiedAt: input.verifiedAt,
    verificationPolicyVersion: input.verificationPolicyVersion,
    revalidationDueAt: null,
    verificationExpiresAt: null,
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

  const verification = (source['verification'] ?? {}) as Record<
    string,
    unknown
  >;
  const expiresAt = verification['expiresAt'];
  if (expiresAt !== null && expiresAt !== undefined) {
    const normalizedExpiresAt = Math.trunc(Number(expiresAt));
    if (!Number.isFinite(normalizedExpiresAt) || normalizedExpiresAt <= Date.now()) {
      return null;
    }
  }

  return {
    target,
    verified: true,
  };
}
