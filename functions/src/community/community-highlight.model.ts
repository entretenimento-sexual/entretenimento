// -----------------------------------------------------------------------------
// COMMUNITY HIGHLIGHT CONTRACT
// -----------------------------------------------------------------------------
// Um destaque é uma projeção editorial da Comunidade, separada da cronologia do
// Mural. A V1 aceita somente uma publicação do Mural como alvo, mas preserva
// targetType para permitir Tópicos no futuro sem alterar o contrato base.
// -----------------------------------------------------------------------------

export type CommunityHighlightAction = 'pin' | 'unpin';
export type CommunityHighlightTargetType = 'feed_post';
export type CommunityHighlightDuration =
  | '24h'
  | '3d'
  | '7d'
  | '30d'
  | 'until_unpinned';

export interface CommunityHighlightRequest {
  requestId?: unknown;
  communityId?: unknown;
  action?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  duration?: unknown;
}

export interface NormalizedCommunityHighlightRequest {
  requestId: string | null;
  communityId: string | null;
  action: CommunityHighlightAction | null;
  targetType: CommunityHighlightTargetType | null;
  targetId: string | null;
  duration: CommunityHighlightDuration | null;
}

export interface CommunityHighlightSnapshot {
  targetType: CommunityHighlightTargetType;
  targetId: string;
  duration: CommunityHighlightDuration;
  pinnedAt: number;
  expiresAt: number | null;
}

export interface CommunityHighlightResponse {
  communityId: string;
  action: CommunityHighlightAction;
  highlight: CommunityHighlightSnapshot | null;
  changed: boolean;
  deduplicated: boolean;
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const DEFAULT_DURATION: CommunityHighlightDuration = '7d';

const HIGHLIGHT_DURATION_MS: Readonly<
  Partial<Record<CommunityHighlightDuration, number>>
> = Object.freeze({
  '24h': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
});

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

function normalizeDuration(value: unknown): CommunityHighlightDuration | null {
  return value === '24h'
    || value === '3d'
    || value === '7d'
    || value === '30d'
    || value === 'until_unpinned'
    ? value
    : null;
}

export function normalizeCommunityHighlightRequest(
  raw: CommunityHighlightRequest | null | undefined
): NormalizedCommunityHighlightRequest {
  const action = raw?.action === 'pin' || raw?.action === 'unpin'
    ? raw.action
    : null;
  const targetType = raw?.targetType === 'feed_post'
    ? 'feed_post'
    : null;
  const suppliedDuration = normalizeDuration(raw?.duration);

  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    action,
    targetType: action === 'pin' ? targetType : null,
    targetId: action === 'pin' ? normalizeSafeId(raw?.targetId) : null,
    duration: action === 'pin'
      ? suppliedDuration ?? DEFAULT_DURATION
      : null,
  };
}

export function resolveCommunityHighlightExpiresAt(
  duration: CommunityHighlightDuration,
  nowMs: number
): number | null {
  if (duration === 'until_unpinned') return null;
  const durationMs = HIGHLIGHT_DURATION_MS[duration];
  return typeof durationMs === 'number' ? nowMs + durationMs : null;
}
