// src/app/core/community/community-official-association.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL ASSOCIATION - PUBLIC CONTRACT
// -----------------------------------------------------------------------------
// O Angular conhece somente a projeção pública da associação oficial.
// Organização patrocinadora, responsável, KYC/KYB, evidências e auditoria são
// dados backend-only e não pertencem a este contrato.
// -----------------------------------------------------------------------------

export const COMMUNITY_OFFICIAL_TARGET_TYPES = [
  'profile',
  'organization',
  'venue',
  'event',
] as const;

export type CommunityOfficialTargetType =
  typeof COMMUNITY_OFFICIAL_TARGET_TYPES[number];

export interface CommunityOfficialAssociationPublic {
  target: {
    type: CommunityOfficialTargetType;
    id: string;
  };
  verified: true;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

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

export function normalizeCommunityOfficialAssociationPublic(
  raw: unknown
): CommunityOfficialAssociationPublic | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawTarget = (source['target'] ?? {}) as Record<string, unknown>;
  const type = normalizeTargetType(rawTarget['type']);
  const id = String(rawTarget['id'] ?? '').trim();

  if (!type || !SAFE_ID_PATTERN.test(id) || source['verified'] !== true) {
    return null;
  }

  return {
    target: { type, id },
    verified: true,
  };
}
