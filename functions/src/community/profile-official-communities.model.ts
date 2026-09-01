// functions/src/community/profile-official-communities.model.ts
// -----------------------------------------------------------------------------
// PROFILE OFFICIAL COMMUNITIES REQUEST
// -----------------------------------------------------------------------------
// O localizador público é exclusivamente `profileId`. UID pertence à conta
// autenticada/interna e não deve ser transportado como identidade social.
// -----------------------------------------------------------------------------

import { normalizePublicProfileId } from '../identity/public-profile-id';

export interface ProfileOfficialCommunitiesRequest {
  profileId?: unknown;
  limit?: unknown;
}

export interface NormalizedProfileOfficialCommunitiesRequest {
  profileId: string;
  limit: number;
}

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 12;

export function normalizeProfileOfficialCommunitiesRequest(
  raw: ProfileOfficialCommunitiesRequest | null | undefined
): NormalizedProfileOfficialCommunitiesRequest | null {
  const profileId = normalizePublicProfileId(raw?.profileId);
  if (!profileId) return null;

  const parsedLimit = Math.trunc(Number(raw?.limit));
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return { profileId, limit };
}
