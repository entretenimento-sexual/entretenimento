// functions/src/community/community-canonical-owner.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY CANONICAL OWNER
// -----------------------------------------------------------------------------
// Resolve a autoridade canônica de propriedade a partir de community.ownerUid.
// Fluxos de membership usam esta política para nunca rebaixar a proteção do
// proprietário apenas porque o papel persistido no membership ficou divergente.
// -----------------------------------------------------------------------------

export type CanonicalCommunityMemberRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member'
  | null;

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function resolveCommunityCanonicalOwnerUid(
  rawCommunity: unknown
): string | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  return normalizeSafeId(community['ownerUid']);
}

export function isCommunityCanonicalOwner(
  rawCommunity: unknown,
  memberUid: unknown
): boolean {
  const ownerUid = resolveCommunityCanonicalOwnerUid(rawCommunity);
  const normalizedMemberUid = normalizeSafeId(memberUid);

  return ownerUid !== null
    && normalizedMemberUid !== null
    && ownerUid === normalizedMemberUid;
}

export function resolveCanonicalCommunityMemberRole(
  rawCommunity: unknown,
  memberUid: unknown,
  membershipRole: CanonicalCommunityMemberRole
): CanonicalCommunityMemberRole {
  return isCommunityCanonicalOwner(rawCommunity, memberUid)
    ? 'owner'
    : membershipRole;
}
