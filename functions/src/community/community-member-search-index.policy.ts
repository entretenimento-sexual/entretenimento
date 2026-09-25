// functions/src/community/community-member-search-index.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER SEARCH INDEX
// -----------------------------------------------------------------------------
// Projeção privada/backend-only para localizar integrantes pelo nickname público.
// Nunca indexa users/{uid}, nome civil, e-mail, KYC, idade ou capabilities.
// Membership e public_profiles continuam canônicos e são revalidados na leitura.
// -----------------------------------------------------------------------------

import { normalizePublicProfileId } from '../identity/public-profile-id';

export const COMMUNITY_MEMBER_SEARCH_INDEX_VERSION = 1;
export const COMMUNITY_MEMBER_SEARCH_MIN_LENGTH = 2;
export const COMMUNITY_MEMBER_SEARCH_MAX_LENGTH = 40;
export const COMMUNITY_MEMBER_SEARCH_MAX_PREFIXES = 48;

export interface CommunityMemberSearchIndexProjection {
  readonly projectionVersion: number;
  readonly communityId: string;
  readonly memberId: string;
  readonly profileId: string;
  readonly publicLabel: string;
  readonly publicLabelNormalized: string;
  readonly searchPrefixes: readonly string[];
}

export interface CommunityMemberSearchCursor {
  readonly query: string;
  readonly publicLabelNormalized: string;
  readonly documentId: string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const OPAQUE_CURSOR_PATTERN = /^v1_[A-Za-z0-9_-]{1,700}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeDisplayText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function timestampToMillis(value: unknown): number | null {
  if (
    value
    && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    try {
      const millis = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeCommunityMemberSearchText(value: unknown): string {
  return normalizeDisplayText(value, COMMUNITY_MEMBER_SEARCH_MAX_LENGTH)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCommunityMemberSearchQuery(
  value: unknown
): string | null {
  const raw = normalizeDisplayText(value, COMMUNITY_MEMBER_SEARCH_MAX_LENGTH);
  if (!raw) return '';

  const normalized = normalizeCommunityMemberSearchText(raw);
  if (
    normalized.length < COMMUNITY_MEMBER_SEARCH_MIN_LENGTH
    || normalized.length > COMMUNITY_MEMBER_SEARCH_MAX_LENGTH
  ) {
    return null;
  }

  return normalized;
}

function buildPrefixes(value: string): readonly string[] {
  if (value.length < COMMUNITY_MEMBER_SEARCH_MIN_LENGTH) return [];

  const candidates = [
    value,
    ...value
      .split(' ')
      .filter(Boolean),
  ].flatMap((candidate) => {
    const prefixes: string[] = [];
    const maxLength = Math.min(
      candidate.length,
      COMMUNITY_MEMBER_SEARCH_MAX_LENGTH
    );

    for (
      let length = COMMUNITY_MEMBER_SEARCH_MIN_LENGTH;
      length <= maxLength;
      length += 1
    ) {
      prefixes.push(candidate.slice(0, length));
    }

    return prefixes;
  });

  return Array.from(new Set(candidates))
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
    .slice(0, COMMUNITY_MEMBER_SEARCH_MAX_PREFIXES);
}

export function isCurrentCommunityMemberSearchPublicProfile(
  rawProfile: unknown,
  nowMs = Date.now()
): boolean {
  const profile = (rawProfile ?? {}) as Record<string, unknown>;
  if (profile['ageEligibilityVerifiedAdult'] !== true) return false;

  const validUntil = timestampToMillis(profile['ageEligibilityValidUntil']);
  return validUntil !== null && validUntil > nowMs;
}

export function buildCommunityMemberSearchIndexProjection(input: {
  readonly communityId: unknown;
  readonly memberId: unknown;
  readonly rawMembership: unknown;
  readonly rawPublicProfile: unknown;
  readonly nowMs?: number;
}): CommunityMemberSearchIndexProjection | null {
  const communityId = normalizeSafeId(input.communityId);
  const memberId = normalizeSafeId(input.memberId);
  const membership = (input.rawMembership ?? {}) as Record<string, unknown>;
  const profile = (input.rawPublicProfile ?? {}) as Record<string, unknown>;
  const nowMs = input.nowMs ?? Date.now();

  if (
    !communityId
    || !memberId
    || membership['status'] !== 'active'
    || !isCurrentCommunityMemberSearchPublicProfile(profile, nowMs)
  ) {
    return null;
  }

  const profileId = normalizePublicProfileId(profile['profileId']);
  const publicLabel = normalizeDisplayText(profile['nickname'], 60);
  const publicLabelNormalized = normalizeCommunityMemberSearchText(publicLabel);

  if (
    !profileId
    || publicLabel.length < COMMUNITY_MEMBER_SEARCH_MIN_LENGTH
    || publicLabelNormalized.length < COMMUNITY_MEMBER_SEARCH_MIN_LENGTH
  ) {
    return null;
  }

  return {
    projectionVersion: COMMUNITY_MEMBER_SEARCH_INDEX_VERSION,
    communityId,
    memberId,
    profileId,
    publicLabel,
    publicLabelNormalized,
    searchPrefixes: buildPrefixes(publicLabelNormalized),
  };
}

export function communityMemberSearchProjectionId(
  communityId: string,
  memberId: string
): string {
  return `${communityId}:${memberId}`;
}

export function communityMemberSearchPublicProfileFingerprint(
  rawProfile: unknown
): string {
  const profile = (rawProfile ?? {}) as Record<string, unknown>;
  const validUntil = timestampToMillis(profile['ageEligibilityValidUntil']);

  return JSON.stringify({
    profileId: normalizePublicProfileId(profile['profileId']),
    nickname: normalizeDisplayText(profile['nickname'], 60),
    adult: profile['ageEligibilityVerifiedAdult'] === true,
    validUntil,
  });
}

export function encodeCommunityMemberSearchCursor(
  cursor: CommunityMemberSearchCursor
): string {
  const payload = JSON.stringify({
    q: cursor.query.slice(0, COMMUNITY_MEMBER_SEARCH_MAX_LENGTH),
    s: cursor.publicLabelNormalized.slice(0, 80),
    d: cursor.documentId.slice(0, 300),
  });

  return `v1_${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

export function decodeCommunityMemberSearchCursor(
  value: unknown
): CommunityMemberSearchCursor | null {
  const token = String(value ?? '').trim();
  if (!OPAQUE_CURSOR_PATTERN.test(token)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(token.slice(3), 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    const query = normalizeCommunityMemberSearchQuery(parsed['q']);
    const publicLabelNormalized = normalizeCommunityMemberSearchText(parsed['s']);
    const documentId = String(parsed['d'] ?? '').trim();

    if (
      !query
      || !publicLabelNormalized
      || !documentId
      || documentId.length > 300
    ) {
      return null;
    }

    return { query, publicLabelNormalized, documentId };
  } catch {
    return null;
  }
}
