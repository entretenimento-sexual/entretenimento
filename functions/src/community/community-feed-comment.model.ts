// -----------------------------------------------------------------------------
// COMMUNITY FEED CONVERSATION CONTRACT
// -----------------------------------------------------------------------------
// `comment` permanece na nomenclatura técnica por compatibilidade de callable e
// coleções. Na experiência do usuário, todos os documentos são mensagens de uma
// única conversa; respostas apontam para outra mensagem por ID.
// -----------------------------------------------------------------------------

import type { CommunityPublicAuthor } from './community-public-author.model';

export type CommunityFeedCommentAction = 'delete_own' | 'remove';
export type CommunityFeedCommentStatus = 'active' | 'deleted' | 'removed';

export interface CommunityFeedCommentReplyReference {
  commentId: string;
  authorLabel: string;
  textPreview: string;
  available: boolean;
}

export interface CommunityFeedCommentPageRequest {
  communityId?: unknown;
  postId?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface CommunityFeedCommentCreateRequest {
  requestId?: unknown;
  communityId?: unknown;
  postId?: unknown;
  text?: unknown;
  /** Somente o ID é aceito do cliente; label/preview são hidratados no backend. */
  replyToCommentId?: unknown;
}

export interface CommunityFeedCommentActionRequest {
  requestId?: unknown;
  communityId?: unknown;
  postId?: unknown;
  commentId?: unknown;
  action?: unknown;
  reason?: unknown;
}

/** @deprecated Compatibilidade com subcoleções de respostas anteriores. */
export interface CommunityFeedCommentReplyPageRequest {
  communityId?: unknown;
  postId?: unknown;
  commentId?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

/** @deprecated Novas respostas usam CommunityFeedCommentCreateRequest.replyToCommentId. */
export interface CommunityFeedCommentReplyCreateRequest {
  requestId?: unknown;
  communityId?: unknown;
  postId?: unknown;
  commentId?: unknown;
  text?: unknown;
}

/** @deprecated Compatibilidade com moderação de respostas anteriores. */
export interface CommunityFeedCommentReplyActionRequest {
  requestId?: unknown;
  communityId?: unknown;
  postId?: unknown;
  commentId?: unknown;
  replyId?: unknown;
  action?: unknown;
  reason?: unknown;
}

export interface CommunityFeedCommentItem {
  commentId: string;
  author: CommunityPublicAuthor;
  text: string;
  replyTo: CommunityFeedCommentReplyReference | null;
  /** Compatibilidade temporária com documentos legados. */
  replyCount: number;
  capabilities: {
    canDeleteOwn: boolean;
    canModerate: boolean;
    canReport: boolean;
  };
  createdAt: number;
}

/** @deprecated Novas respostas são CommunityFeedCommentItem na timeline plana. */
export interface CommunityFeedCommentReplyItem {
  replyId: string;
  author: CommunityPublicAuthor;
  text: string;
  capabilities: {
    canDeleteOwn: boolean;
    canModerate: boolean;
    canReport: boolean;
  };
  createdAt: number;
}

export interface CommunityFeedCommentPageResponse {
  items: CommunityFeedCommentItem[];
  nextCursor: string | null;
  generatedAt: number;
}

/** @deprecated Compatibilidade com leitura de respostas anteriores. */
export interface CommunityFeedCommentReplyPageResponse {
  items: CommunityFeedCommentReplyItem[];
  nextCursor: string | null;
  generatedAt: number;
}

export interface CommunityFeedCommentCreateResponse {
  communityId: string;
  postId: string;
  commentId: string;
  commentCount: number;
  created: boolean;
  deduplicated: boolean;
}

/** @deprecated Compatibilidade com resposta de callable anterior. */
export interface CommunityFeedCommentReplyCreateResponse {
  communityId: string;
  postId: string;
  commentId: string;
  replyId: string;
  replyCount: number;
  created: boolean;
  deduplicated: boolean;
}

export interface CommunityFeedCommentActionResponse {
  communityId: string;
  postId: string;
  commentId: string;
  action: CommunityFeedCommentAction;
  status: CommunityFeedCommentStatus;
  commentCount: number;
  deduplicated: boolean;
  generatedAt: number;
}

/** @deprecated Compatibilidade com moderação de respostas anteriores. */
export interface CommunityFeedCommentReplyActionResponse {
  communityId: string;
  postId: string;
  commentId: string;
  replyId: string;
  action: CommunityFeedCommentAction;
  status: CommunityFeedCommentStatus;
  replyCount: number;
  deduplicated: boolean;
  generatedAt: number;
}

export interface NormalizedCommunityFeedCommentPageRequest {
  communityId: string | null;
  postId: string | null;
  limit: number;
  cursor: string | null;
}

export interface NormalizedCommunityFeedCommentCreateRequest {
  requestId: string | null;
  communityId: string | null;
  postId: string | null;
  text: string;
  textTooLong: boolean;
}

export interface NormalizedCommunityFeedCommentActionRequest {
  requestId: string | null;
  communityId: string | null;
  postId: string | null;
  commentId: string | null;
  action: CommunityFeedCommentAction | null;
  reason: string | null;
  reasonTooLong: boolean;
}

/** @deprecated Compatibilidade com respostas anteriores. */
export interface NormalizedCommunityFeedCommentReplyPageRequest {
  communityId: string | null;
  postId: string | null;
  commentId: string | null;
  limit: number;
  cursor: string | null;
}

/** @deprecated Compatibilidade com respostas anteriores. */
export interface NormalizedCommunityFeedCommentReplyCreateRequest {
  requestId: string | null;
  communityId: string | null;
  postId: string | null;
  commentId: string | null;
  text: string;
  textTooLong: boolean;
}

/** @deprecated Compatibilidade com respostas anteriores. */
export interface NormalizedCommunityFeedCommentReplyActionRequest {
  requestId: string | null;
  communityId: string | null;
  postId: string | null;
  commentId: string | null;
  replyId: string | null;
  action: CommunityFeedCommentAction | null;
  reason: string | null;
  reasonTooLong: boolean;
}

export interface SanitizedCommunityFeedComment {
  actorUid: string;
  item: CommunityFeedCommentItem;
}

/** @deprecated Compatibilidade com respostas anteriores. */
export interface SanitizedCommunityFeedCommentReply {
  actorUid: string;
  item: CommunityFeedCommentReplyItem;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 30;
const DEFAULT_REPLY_PAGE_LIMIT = 8;
const MAX_REPLY_PAGE_LIMIT = 24;

function normalizeText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 9 || codePoint === 10 || codePoint === 13) return ' ';
      return codePoint >= 32 && codePoint !== 127 ? character : '';
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

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), 1_000_000_000)
    : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }
  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };
    if (typeof source.toMillis === 'function') {
      const time = Number(source.toMillis());
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const time = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
  }
  return null;
}

function normalizeAction(value: unknown): CommunityFeedCommentAction | null {
  return value === 'delete_own' || value === 'remove' ? value : null;
}

function normalizeReason(value: unknown): { reason: string | null; reasonTooLong: boolean } {
  const reason = normalizeText(value, 241);
  return {
    reason: reason || null,
    reasonTooLong: reason.length > 240,
  };
}

export function normalizeCommunityFeedCommentPageRequest(
  raw: CommunityFeedCommentPageRequest | null | undefined
): NormalizedCommunityFeedCommentPageRequest {
  const parsedLimit = Math.trunc(Number(raw?.limit));
  return {
    communityId: normalizeSafeId(raw?.communityId),
    postId: normalizeSafeId(raw?.postId),
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT,
    cursor: normalizeSafeId(raw?.cursor),
  };
}

export function normalizeCommunityFeedCommentCreateRequest(
  raw: CommunityFeedCommentCreateRequest | null | undefined
): NormalizedCommunityFeedCommentCreateRequest {
  const text = normalizeText(raw?.text, 501);
  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    postId: normalizeSafeId(raw?.postId),
    text: text.slice(0, 500),
    textTooLong: text.length > 500,
  };
}

export function normalizeCommunityFeedCommentActionRequest(
  raw: CommunityFeedCommentActionRequest | null | undefined
): NormalizedCommunityFeedCommentActionRequest {
  const normalizedReason = normalizeReason(raw?.reason);
  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    postId: normalizeSafeId(raw?.postId),
    commentId: normalizeSafeId(raw?.commentId),
    action: normalizeAction(raw?.action),
    ...normalizedReason,
  };
}

export function normalizeCommunityFeedCommentReplyPageRequest(
  raw: CommunityFeedCommentReplyPageRequest | null | undefined
): NormalizedCommunityFeedCommentReplyPageRequest {
  const parsedLimit = Math.trunc(Number(raw?.limit));
  return {
    communityId: normalizeSafeId(raw?.communityId),
    postId: normalizeSafeId(raw?.postId),
    commentId: normalizeSafeId(raw?.commentId),
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_REPLY_PAGE_LIMIT)
      : DEFAULT_REPLY_PAGE_LIMIT,
    cursor: normalizeSafeId(raw?.cursor),
  };
}

export function normalizeCommunityFeedCommentReplyCreateRequest(
  raw: CommunityFeedCommentReplyCreateRequest | null | undefined
): NormalizedCommunityFeedCommentReplyCreateRequest {
  const text = normalizeText(raw?.text, 501);
  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    postId: normalizeSafeId(raw?.postId),
    commentId: normalizeSafeId(raw?.commentId),
    text: text.slice(0, 500),
    textTooLong: text.length > 500,
  };
}

export function normalizeCommunityFeedCommentReplyActionRequest(
  raw: CommunityFeedCommentReplyActionRequest | null | undefined
): NormalizedCommunityFeedCommentReplyActionRequest {
  const normalizedReason = normalizeReason(raw?.reason);
  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    postId: normalizeSafeId(raw?.postId),
    commentId: normalizeSafeId(raw?.commentId),
    replyId: normalizeSafeId(raw?.replyId),
    action: normalizeAction(raw?.action),
    ...normalizedReason,
  };
}

export function sanitizeCommunityFeedComment(
  documentId: string,
  raw: unknown,
  now = Date.now()
): SanitizedCommunityFeedComment | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const author = (source['author'] ?? {}) as Record<string, unknown>;
  const metrics = (source['metrics'] ?? {}) as Record<string, unknown>;
  const commentId = normalizeSafeId(documentId);
  const actorUid = normalizeSafeId(source['actorUid']);
  const authorLabel = normalizeText(author['label'], 60);
  const text = normalizeText(source['text'], 500);
  const createdAt = normalizeTimestamp(source['createdAt']);

  if (
    !commentId
    || !actorUid
    || authorLabel.length < 2
    || !text
    || source['status'] !== 'active'
    || source['moderationState'] !== 'active'
    || createdAt === null
    || createdAt < Date.UTC(2000, 0, 1)
    || createdAt > now + 5 * 60_000
  ) {
    return null;
  }

  return {
    actorUid,
    item: {
      commentId,
      author: {
        label: authorLabel,
        avatarUrl: normalizeHttpsUrl(author['avatarUrl']),
        profileType: null,
        profileTypeLabel: null,
        city: null,
        state: null,
      },
      text,
      replyTo: null,
      replyCount: normalizeCount(metrics['replyCount']),
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
      },
      createdAt,
    },
  };
}

export function sanitizeCommunityFeedCommentReply(
  documentId: string,
  raw: unknown,
  expectedCommentId: string,
  now = Date.now()
): SanitizedCommunityFeedCommentReply | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const author = (source['author'] ?? {}) as Record<string, unknown>;
  const replyId = normalizeSafeId(documentId);
  const actorUid = normalizeSafeId(source['actorUid']);
  const parentCommentId = normalizeSafeId(source['commentId']);
  const authorLabel = normalizeText(author['label'], 60);
  const text = normalizeText(source['text'], 500);
  const createdAt = normalizeTimestamp(source['createdAt']);

  if (
    !replyId
    || !actorUid
    || !parentCommentId
    || parentCommentId !== expectedCommentId
    || authorLabel.length < 2
    || !text
    || source['status'] !== 'active'
    || source['moderationState'] !== 'active'
    || createdAt === null
    || createdAt < Date.UTC(2000, 0, 1)
    || createdAt > now + 5 * 60_000
  ) {
    return null;
  }

  return {
    actorUid,
    item: {
      replyId,
      author: {
        label: authorLabel,
        avatarUrl: normalizeHttpsUrl(author['avatarUrl']),
        profileType: null,
        profileTypeLabel: null,
        city: null,
        state: null,
      },
      text,
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
      },
      createdAt,
    },
  };
}
