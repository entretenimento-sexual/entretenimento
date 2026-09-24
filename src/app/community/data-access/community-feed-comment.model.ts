// -----------------------------------------------------------------------------
// COMMUNITY FEED COMMENT CLIENT CONTRACT
// -----------------------------------------------------------------------------

import {
  CommunityPublicAuthor,
  normalizeCommunityPublicAuthor,
} from './community-public-author.model';

export type CommunityFeedCommentAction = 'delete_own' | 'remove';

export interface CommunityFeedCommentReplyReference {
  readonly commentId: string;
  readonly authorLabel: string;
  readonly textPreview: string;
  readonly available: boolean;
}

export interface CommunityFeedCommentItem {
  readonly commentId: string;
  readonly author: CommunityPublicAuthor;
  readonly text: string;
  /**
   * Referência sanitizada a outra mensagem da mesma conversa.
   * O navegador nunca envia authorLabel/textPreview como fonte de verdade.
   */
  readonly replyTo: CommunityFeedCommentReplyReference | null;
  readonly capabilities: {
    readonly canDeleteOwn: boolean;
    readonly canModerate: boolean;
    readonly canReport: boolean;
  };
  readonly createdAt: number;
}

export interface CommunityFeedCommentPage {
  readonly items: readonly CommunityFeedCommentItem[];
  readonly nextCursor: string | null;
  readonly generatedAt: number;
}

export interface CommunityFeedCommentPageRequest {
  readonly communityId: string;
  readonly postId: string;
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface CommunityFeedCommentCreateRequest {
  readonly requestId: string;
  readonly communityId: string;
  readonly postId: string;
  readonly text: string;
  /** ID da mensagem citada. A citação textual é sempre hidratada pelo backend. */
  readonly replyToCommentId?: string | null;
}

export interface CommunityFeedCommentCreateResponse {
  readonly communityId: string;
  readonly postId: string;
  readonly commentId: string;
  readonly commentCount: number;
  readonly created: boolean;
  readonly deduplicated: boolean;
}

export interface CommunityFeedCommentActionRequest {
  readonly requestId: string;
  readonly communityId: string;
  readonly postId: string;
  readonly commentId: string;
  readonly action: CommunityFeedCommentAction;
  readonly reason?: string | null;
}

export interface CommunityFeedCommentActionResponse {
  readonly communityId: string;
  readonly postId: string;
  readonly commentId: string;
  readonly action: CommunityFeedCommentAction;
  readonly status: 'deleted' | 'removed';
  readonly commentCount: number;
  readonly deduplicated: boolean;
  readonly generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MIN_CREATED_AT = Date.UTC(2000, 0, 1);

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

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), 1_000_000_000)
    : 0;
}

function normalizeCreatedAt(value: unknown): number | null {
  const createdAt = Number(value);
  if (
    !Number.isFinite(createdAt)
    || createdAt < MIN_CREATED_AT
    || createdAt > Date.now() + 5 * 60_000
  ) {
    return null;
  }
  return Math.trunc(createdAt);
}

function normalizeCapabilities(raw: unknown) {
  const capabilities = (raw ?? {}) as Record<string, unknown>;
  return {
    canDeleteOwn: capabilities['canDeleteOwn'] === true,
    canModerate: capabilities['canModerate'] === true,
    canReport: capabilities['canReport'] === true,
  };
}

function normalizeReplyReference(raw: unknown): CommunityFeedCommentReplyReference | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const commentId = normalizeSafeId(source['commentId']);
  if (!commentId) return null;
  const available = source['available'] !== false;
  return {
    commentId,
    authorLabel: normalizeText(source['authorLabel'], 60)
      || (available ? 'Participante' : 'Mensagem indisponível'),
    textPreview: normalizeText(source['textPreview'], 180),
    available,
  };
}

function normalizeItem(raw: unknown): CommunityFeedCommentItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const commentId = normalizeSafeId(source['commentId']);
  const author = normalizeCommunityPublicAuthor(source['author']);
  const text = normalizeText(source['text'], 500);
  const createdAt = normalizeCreatedAt(source['createdAt']);
  if (!commentId || !author || !text || createdAt === null) {
    return null;
  }
  return {
    commentId,
    author,
    text,
    replyTo: normalizeReplyReference(source['replyTo']),
    capabilities: normalizeCapabilities(source['capabilities']),
    createdAt,
  };
}

export function normalizeCommunityFeedCommentPageResponse(
  raw: unknown
): CommunityFeedCommentPage {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = Number(source['generatedAt']);
  return {
    items: Array.isArray(source['items'])
      ? source['items']
          .map(normalizeItem)
          .filter((item): item is CommunityFeedCommentItem => item !== null)
      : [],
    nextCursor: normalizeSafeId(source['nextCursor']),
    generatedAt: Number.isFinite(generatedAt)
      ? Math.trunc(generatedAt)
      : Date.now(),
  };
}

export function normalizeCommunityFeedCommentCreateResponse(
  raw: unknown
): CommunityFeedCommentCreateResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const postId = normalizeSafeId(source['postId']);
  const commentId = normalizeSafeId(source['commentId']);
  if (!communityId || !postId || !commentId) {
    throw new Error('Resposta de comentário no Mural inválida.');
  }
  return {
    communityId,
    postId,
    commentId,
    commentCount: normalizeCount(source['commentCount']),
    created: source['created'] === true,
    deduplicated: source['deduplicated'] === true,
  };
}

export function normalizeCommunityFeedCommentActionResponse(
  raw: unknown
): CommunityFeedCommentActionResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const postId = normalizeSafeId(source['postId']);
  const commentId = normalizeSafeId(source['commentId']);
  const action = source['action'];
  const status = source['status'];
  const generatedAt = Number(source['generatedAt']);
  if (
    !communityId
    || !postId
    || !commentId
    || (action !== 'delete_own' && action !== 'remove')
    || (status !== 'deleted' && status !== 'removed')
    || !Number.isFinite(generatedAt)
  ) {
    throw new Error('Resposta de ação de comentário inválida.');
  }
  return {
    communityId,
    postId,
    commentId,
    action,
    status,
    commentCount: normalizeCount(source['commentCount']),
    deduplicated: source['deduplicated'] === true,
    generatedAt: Math.trunc(generatedAt),
  };
}

