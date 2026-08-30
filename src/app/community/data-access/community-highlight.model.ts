// src/app/community/data-access/community-highlight.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY HIGHLIGHT CLIENT CONTRACT
// -----------------------------------------------------------------------------
// O destaque editorial permanece separado da cronologia do Mural. Toda resposta
// das callables é normalizada novamente no navegador antes de chegar à UI.
// -----------------------------------------------------------------------------

export type CommunityHighlightAction = 'pin' | 'unpin';
export type CommunityHighlightTargetType = 'feed_post';
export type CommunityHighlightDuration =
  | '24h'
  | '3d'
  | '7d'
  | '30d'
  | 'until_unpinned';

export interface CommunityHighlightSnapshot {
  readonly targetType: CommunityHighlightTargetType;
  readonly targetId: string;
  readonly duration: CommunityHighlightDuration;
  readonly pinnedAt: number;
  readonly expiresAt: number | null;
}

export interface CommunityHighlightReadRequest {
  readonly communityId: string;
}

export interface CommunityHighlightReadResponse {
  readonly communityId: string;
  readonly highlight: CommunityHighlightSnapshot | null;
  readonly canManage: boolean;
  readonly generatedAt: number;
}

export interface CommunityHighlightManageRequest {
  readonly requestId: string;
  readonly communityId: string;
  readonly action: CommunityHighlightAction;
  readonly targetType?: CommunityHighlightTargetType | null;
  readonly targetId?: string | null;
  readonly duration?: CommunityHighlightDuration | null;
}

export interface CommunityHighlightManageResponse {
  readonly communityId: string;
  readonly action: CommunityHighlightAction;
  readonly highlight: CommunityHighlightSnapshot | null;
  readonly changed: boolean;
  readonly deduplicated: boolean;
  readonly generatedAt: number;
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

function normalizeDuration(value: unknown): CommunityHighlightDuration | null {
  return value === '24h'
    || value === '3d'
    || value === '7d'
    || value === '30d'
    || value === 'until_unpinned'
    ? value
    : null;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function normalizeCommunityHighlightSnapshot(
  raw: unknown
): CommunityHighlightSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const targetId = normalizeSafeId(source['targetId']);
  const duration = normalizeDuration(source['duration']);
  const pinnedAt = normalizeTimestamp(source['pinnedAt']);
  const expiresAt = source['expiresAt'] === null
    ? null
    : normalizeTimestamp(source['expiresAt']);

  if (
    source['targetType'] !== 'feed_post'
    || !targetId
    || !duration
    || pinnedAt === null
    || (source['expiresAt'] !== null && expiresAt === null)
    || (duration === 'until_unpinned' && expiresAt !== null)
    || (duration !== 'until_unpinned' && (expiresAt === null || expiresAt <= pinnedAt))
  ) {
    return null;
  }

  return {
    targetType: 'feed_post',
    targetId,
    duration,
    pinnedAt,
    expiresAt,
  };
}

export function normalizeCommunityHighlightReadResponse(
  raw: unknown
): CommunityHighlightReadResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const generatedAt = normalizeTimestamp(source['generatedAt']);
  const highlight = source['highlight'] == null
    ? null
    : normalizeCommunityHighlightSnapshot(source['highlight']);

  if (
    !communityId
    || generatedAt === null
    || typeof source['canManage'] !== 'boolean'
    || (source['highlight'] != null && !highlight)
  ) {
    throw new Error('Resposta de destaque da Comunidade inválida.');
  }

  return {
    communityId,
    highlight,
    canManage: source['canManage'] === true,
    generatedAt,
  };
}

export function normalizeCommunityHighlightManageResponse(
  raw: unknown
): CommunityHighlightManageResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const action = source['action'];
  const generatedAt = normalizeTimestamp(source['generatedAt']);
  const highlight = source['highlight'] == null
    ? null
    : normalizeCommunityHighlightSnapshot(source['highlight']);

  if (
    !communityId
    || (action !== 'pin' && action !== 'unpin')
    || generatedAt === null
    || typeof source['changed'] !== 'boolean'
    || typeof source['deduplicated'] !== 'boolean'
    || (source['highlight'] != null && !highlight)
    || (action === 'pin' && !highlight)
    || (action === 'unpin' && highlight !== null)
  ) {
    throw new Error('Resposta de gestão do destaque da Comunidade inválida.');
  }

  return {
    communityId,
    action,
    highlight,
    changed: source['changed'] === true,
    deduplicated: source['deduplicated'] === true,
    generatedAt,
  };
}

export function isCommunityHighlightActive(
  highlight: CommunityHighlightSnapshot,
  nowMs = Date.now()
): boolean {
  return highlight.expiresAt === null || highlight.expiresAt > nowMs;
}
