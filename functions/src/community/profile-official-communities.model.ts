// functions/src/community/profile-official-communities.model.ts
// -----------------------------------------------------------------------------
// PROFILE OFFICIAL COMMUNITIES REQUEST
// -----------------------------------------------------------------------------

export interface ProfileOfficialCommunitiesRequest {
  profileUid?: unknown;
  limit?: unknown;
}

export interface NormalizedProfileOfficialCommunitiesRequest {
  profileUid: string;
  limit: number;
}

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 12;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function normalizeProfileUid(value: unknown): string | null {
  const normalized = String(value ?? '').trim();

  if (
    !normalized
    || normalized.length > 128
    || normalized.includes('/')
    || hasControlCharacter(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function normalizeProfileOfficialCommunitiesRequest(
  raw: ProfileOfficialCommunitiesRequest | null | undefined
): NormalizedProfileOfficialCommunitiesRequest | null {
  const profileUid = normalizeProfileUid(raw?.profileUid);
  if (!profileUid) return null;

  const parsedLimit = Math.trunc(Number(raw?.limit));
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return { profileUid, limit };
}
