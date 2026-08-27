// -----------------------------------------------------------------------------
// COMMUNITY FEED REPORT CONTRACT
// -----------------------------------------------------------------------------

export type CommunityFeedReportReason =
  | 'spam'
  | 'fake_profile'
  | 'harassment'
  | 'hate_or_abuse'
  | 'sexual_boundary'
  | 'illegal_content'
  | 'privacy'
  | 'minor_safety'
  | 'other';

export interface CommunityFeedReportRequest {
  communityId?: unknown;
  postId?: unknown;
  reason?: unknown;
  details?: unknown;
  route?: unknown;
}

export interface CommunityFeedCommentReportRequest
extends CommunityFeedReportRequest {
  commentId?: unknown;
}

export interface CommunityFeedCommentReplyReportRequest
extends CommunityFeedCommentReportRequest {
  replyId?: unknown;
}

export interface NormalizedCommunityFeedReportRequest {
  communityId: string | null;
  postId: string | null;
  reason: CommunityFeedReportReason | null;
  details: string | null;
  route: string | null;
}

export interface NormalizedCommunityFeedCommentReportRequest
extends NormalizedCommunityFeedReportRequest {
  commentId: string | null;
}

export interface NormalizedCommunityFeedCommentReplyReportRequest
extends NormalizedCommunityFeedCommentReportRequest {
  replyId: string | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const ALLOWED_REASONS = new Set<CommunityFeedReportReason>([
  'spam',
  'fake_profile',
  'harassment',
  'hate_or_abuse',
  'sexual_boundary',
  'illegal_content',
  'privacy',
  'minor_safety',
  'other',
]);

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

export function normalizeCommunityFeedReportRequest(
  raw: CommunityFeedReportRequest | null | undefined
): NormalizedCommunityFeedReportRequest {
  const reason = normalizeText(raw?.reason, 40) as CommunityFeedReportReason;
  const details = normalizeText(raw?.details, 1_200);
  const route = normalizeText(raw?.route, 300);

  return {
    communityId: normalizeSafeId(raw?.communityId),
    postId: normalizeSafeId(raw?.postId),
    reason: ALLOWED_REASONS.has(reason) ? reason : null,
    details: details || null,
    route: route || null,
  };
}

export function normalizeCommunityFeedCommentReportRequest(
  raw: CommunityFeedCommentReportRequest | null | undefined
): NormalizedCommunityFeedCommentReportRequest {
  return {
    ...normalizeCommunityFeedReportRequest(raw),
    commentId: normalizeSafeId(raw?.commentId),
  };
}

export function normalizeCommunityFeedCommentReplyReportRequest(
  raw: CommunityFeedCommentReplyReportRequest | null | undefined
): NormalizedCommunityFeedCommentReplyReportRequest {
  return {
    ...normalizeCommunityFeedCommentReportRequest(raw),
    replyId: normalizeSafeId(raw?.replyId),
  };
}
