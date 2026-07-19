// src/app/community/data-access/community-create.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY CREATION - CLIENT CONTRACTS
// -----------------------------------------------------------------------------

export type CommunityCreateTheme =
  | 'regional'
  | 'interests'
  | 'identity'
  | 'events'
  | 'lifestyle'
  | 'other';

export type CommunityCreateJoinPolicy = 'open' | 'approval';
export type CommunityCreateAccessTier = 'all' | 'premium' | 'vip';

export interface CommunityCreateCommand {
  requestId: string;
  name: string;
  theme: CommunityCreateTheme;
  description: string | null;
  rules: string;
  joinPolicy: CommunityCreateJoinPolicy;
  accessTier: CommunityCreateAccessTier;
}

export interface CommunityCreateResult {
  communityId: string;
  created: boolean;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeCommunityCreateResult(
  raw: unknown
): CommunityCreateResult | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);

  if (!communityId) return null;

  return {
    communityId,
    created: source['created'] === true,
  };
}
