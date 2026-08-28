// -----------------------------------------------------------------------------
// COMMUNITY FEED MODERATION CONTRACT
// -----------------------------------------------------------------------------

export type CommunityFeedPostAction = 'delete_own' | 'remove';
export type CommunityFeedPostOperationalStatus = 'active' | 'deleted' | 'removed';

export interface CommunityFeedPostActionRequest {
  requestId?: unknown;
  communityId?: unknown;
  postId?: unknown;
  action?: unknown;
  reason?: unknown;
}

export interface NormalizedCommunityFeedPostActionRequest {
  requestId: string | null;
  communityId: string | null;
  postId: string | null;
  action: CommunityFeedPostAction | null;
  reason: string | null;
  reasonTooLong: boolean;
}

export interface CommunityFeedPostActionResponse {
  communityId: string;
  postId: string;
  action: CommunityFeedPostAction;
  status: CommunityFeedPostOperationalStatus;
  deduplicated: boolean;
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127 ? character : ' ';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeCommunityFeedPostActionRequest(
  raw: CommunityFeedPostActionRequest | null | undefined
): NormalizedCommunityFeedPostActionRequest {
  const rawReason = normalizeText(raw?.reason, 241);

  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    postId: normalizeSafeId(raw?.postId),
    action: raw?.action === 'delete_own' || raw?.action === 'remove'
      ? raw.action
      : null,
    reason: rawReason || null,
    reasonTooLong: rawReason.length > 240,
  };
}
