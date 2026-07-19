// src/app/community/data-access/venue-community-create.model.ts
// -----------------------------------------------------------------------------
// VENUE COMMUNITY CREATION - CLIENT CONTRACTS
// -----------------------------------------------------------------------------

export type VenueCommunityCreateKind =
  | 'bar'
  | 'club'
  | 'restaurant'
  | 'pub'
  | 'event_space'
  | 'hotel'
  | 'other';

export type VenueCommunityCreateJoinPolicy = 'open' | 'approval';

export interface VenueCommunityCreateCommand {
  requestId: string;
  name: string;
  kind: VenueCommunityCreateKind;
  description: string | null;
  region: {
    uf: string;
    city: string;
    district: string | null;
  };
  addressHint: string | null;
  joinPolicy: VenueCommunityCreateJoinPolicy;
}

export interface VenueCommunityCreateResult {
  venueId: string;
  communityId: string;
  created: boolean;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeVenueCommunityCreateResult(
  raw: unknown
): VenueCommunityCreateResult | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const venueId = normalizeSafeId(source['venueId']);
  const communityId = normalizeSafeId(source['communityId']);

  if (!venueId || !communityId) {
    return null;
  }

  return {
    venueId,
    communityId,
    created: source['created'] === true,
  };
}
