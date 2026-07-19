// functions/src/community/community-user-index.projection.ts
// -----------------------------------------------------------------------------
// COMMUNITY USER INDEX PROJECTION
// -----------------------------------------------------------------------------
// Projeção privada, mínima e backend-only usada por “Minhas comunidades”.
// Não expõe lista de membros, dados pessoais ou qualquer conteúdo administrativo.
// -----------------------------------------------------------------------------

export type CommunityUserIndexRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface CommunityUserIndexProjection {
  communityId: string;
  name: string;
  source: {
    type: 'community' | 'venue';
    id: string;
  };
  role: CommunityUserIndexRole;
  status: 'active';
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeRole(value: unknown): CommunityUserIndexRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

export function buildCommunityUserIndexProjection(
  communityIdRaw: unknown,
  rawCommunity: unknown,
  rawMembership: unknown
): CommunityUserIndexProjection | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(communityIdRaw);
  const sourceId = normalizeSafeId(source['id']);
  const sourceType = source['type'];
  const role = normalizeRole(membership['role']);
  const name = normalizeText(community['name'], 80);

  if (
    !communityId
    || !sourceId
    || (sourceType !== 'community' && sourceType !== 'venue')
    || name.length < 2
    || membership['status'] !== 'active'
    || !role
  ) {
    return null;
  }

  return {
    communityId,
    name,
    source: { type: sourceType, id: sourceId },
    role,
    status: 'active',
  };
}
