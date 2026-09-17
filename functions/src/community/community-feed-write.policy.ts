// functions/src/community/community-feed-write.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED WRITE POLICY
// -----------------------------------------------------------------------------
// Decide autorização, audiência efetiva e quota funcional sem acessar Firebase.
// A audiência final segue a visibilidade da Comunidade; o autor não escolhe
// individualmente se uma publicação entra ou não na prévia autenticada.
// Os valores moduláveis de produto ficam em community-product-limits.config.ts.
// -----------------------------------------------------------------------------

import { CommunityFeedAudience } from './community-feed.model';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

export type CommunityFeedWriterRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member'
  | null;

export type CommunityFeedWriteDenialReason =
  | 'community_unavailable'
  | 'active_membership_required';

export interface CommunityFeedWriteDecision {
  allowed: boolean;
  denialReason: CommunityFeedWriteDenialReason | null;
}

export interface CommunityFeedRateWindowDecision {
  allowed: boolean;
  windowStartedAt: number;
  nextCount: number;
}

const FEED_POST_QUOTA = COMMUNITY_PRODUCT_LIMITS.contentWriteQuotas.feedPosts;

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

export function evaluateCommunityFeedWrite(input: {
  sourceType: unknown;
  memberActivityAllowed: boolean;
  membershipStatus: unknown;
  viewerRole: CommunityFeedWriterRole;
}): Readonly<CommunityFeedWriteDecision> {
  if (input.sourceType !== 'community' || !input.memberActivityAllowed) {
    return { allowed: false, denialReason: 'community_unavailable' };
  }

  if (input.membershipStatus !== 'active' || input.viewerRole === null) {
    return { allowed: false, denialReason: 'active_membership_required' };
  }

  return { allowed: true, denialReason: null };
}

export function resolveCommunityFeedAudience(
  communityVisibility: unknown
): CommunityFeedAudience {
  return communityVisibility === 'public_preview'
    ? 'public_preview'
    : 'members_only';
}

export function resolveCommunityFeedWriteLimit(rawConfig: unknown): number {
  const config = (rawConfig ?? {}) as Record<string, unknown>;
  return normalizePositiveInteger(
    config['maxFeedPostsPer24h'],
    FEED_POST_QUOTA.defaultLimit,
    FEED_POST_QUOTA.minLimit,
    FEED_POST_QUOTA.maxLimit
  );
}

export function evaluateCommunityFeedRateWindow(
  rawState: unknown,
  now: number,
  limit: number
): Readonly<CommunityFeedRateWindowDecision> {
  const state = (rawState ?? {}) as Record<string, unknown>;
  const currentStart = normalizeTimestamp(state['windowStartedAt']);
  const withinWindow = currentStart !== null
    && now >= currentStart
    && now - currentStart < FEED_POST_QUOTA.windowMs;
  const currentCount = withinWindow
    ? normalizeCount(state['writesInWindow'])
    : 0;

  if (currentCount >= limit) {
    return {
      allowed: false,
      windowStartedAt: currentStart ?? now,
      nextCount: currentCount,
    };
  }

  return {
    allowed: true,
    windowStartedAt: withinWindow && currentStart !== null ? currentStart : now,
    nextCount: currentCount + 1,
  };
}
