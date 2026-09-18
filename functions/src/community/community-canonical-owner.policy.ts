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

export type CanonicalCommunityManagerRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | null;

export type CommunityCanonicalOwnerPointerState =
  | Readonly<{ kind: 'absent'; uid: null }>
  | Readonly<{ kind: 'valid'; uid: string }>
  | Readonly<{ kind: 'invalid'; uid: null }>;

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function classifyCommunityCanonicalOwnerPointer(
  rawCommunity: unknown
): CommunityCanonicalOwnerPointerState {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const rawOwnerUid = community['ownerUid'];
  const normalizedText = String(rawOwnerUid ?? '').trim();

  if (!normalizedText) {
    return { kind: 'absent', uid: null };
  }

  const uid = normalizeSafeId(rawOwnerUid);
  return uid
    ? { kind: 'valid', uid }
    : { kind: 'invalid', uid: null };
}

export function resolveCommunityCanonicalOwnerUid(
  rawCommunity: unknown
): string | null {
  const state = classifyCommunityCanonicalOwnerPointer(rawCommunity);
  return state.kind === 'valid' ? state.uid : null;
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

/**
 * Resolve autoridade operacional do ator de forma estrita.
 *
 * `owner` persistido em membership nunca concede propriedade a um UID que não
 * corresponde a community.ownerUid. Isso fecha dados legados/corrompidos sem
 * rebaixar o proprietário canônico quando o papel persistido divergiu.
 */
export function resolveCanonicalCommunityManagerRole(
  rawCommunity: unknown,
  memberUid: unknown,
  rawMembership: unknown
): CanonicalCommunityManagerRole {
  const membership = (rawMembership ?? {}) as Record<string, unknown>;

  if (membership['status'] !== 'active') return null;

  if (isCommunityCanonicalOwner(rawCommunity, memberUid)) {
    return 'owner';
  }

  const role = membership['role'];
  if (role === 'owner') return null;

  return role === 'admin' || role === 'moderator' ? role : null;
}
