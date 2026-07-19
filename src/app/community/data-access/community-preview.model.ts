// src/app/community/data-access/community-preview.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY PREVIEW CLIENT CONTRACTS
// -----------------------------------------------------------------------------
// O frontend normaliza novamente toda resposta das callables.
// -----------------------------------------------------------------------------

export type CommunityPreviewSourceType = 'venue' | 'room';
export type CommunityPreviewJoinPolicy = 'open' | 'approval' | 'invite_only';
export type CommunityPreviewViewerMode =
  | 'visitor'
  | 'pending'
  | 'member'
  | 'moderator'
  | 'manager';
export type CommunityPreviewMinimumRole = 'basic' | 'premium' | 'vip';

export interface CommunityPreviewCard {
  communityId: string;
  name: string;
  slug: string;
  description: string | null;
  source: {
    type: CommunityPreviewSourceType;
    id: string;
  };
  avatarUrl: string | null;
  coverUrl: string | null;
  metrics: {
    memberCount: number;
    postCount: number;
    mediaCount: number;
  };
  access: {
    join: CommunityPreviewJoinPolicy;
    minimumRole: CommunityPreviewMinimumRole | null;
    requiresActiveSubscription: boolean;
  };
}

export interface CommunityDiscoveryPage {
  items: readonly CommunityPreviewCard[];
  nextCursor: string | null;
  generatedAt: number;
}

export interface CommunityDiscoveryPageRequest {
  limit?: number;
  cursor?: string | null;
  sourceType?: CommunityPreviewSourceType | null;
}

export interface CommunityPreviewResponse {
  community: CommunityPreviewCard;
  viewerMode: CommunityPreviewViewerMode;
  canInteract: boolean;
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
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

  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), 0), 1_000_000_000)
    : 0;
}

function normalizeCard(raw: unknown): CommunityPreviewCard | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const sourceData = (source['source'] ?? {}) as Record<string, unknown>;
  const metrics = (source['metrics'] ?? {}) as Record<string, unknown>;
  const access = (source['access'] ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const sourceId = normalizeSafeId(sourceData['id']);
  const sourceType = sourceData['type'];
  const name = normalizeText(source['name'], 80);
  const slug = normalizeText(source['slug'], 100);

  if (
    !communityId
    || !sourceId
    || (sourceType !== 'venue' && sourceType !== 'room')
    || name.length < 2
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    return null;
  }

  const description = normalizeText(source['description'], 240);
  const join = access['join'];
  const minimumRole = access['minimumRole'];

  return {
    communityId,
    name,
    slug,
    description: description || null,
    source: { type: sourceType, id: sourceId },
    avatarUrl: normalizeHttpsUrl(source['avatarUrl']),
    coverUrl: normalizeHttpsUrl(source['coverUrl']),
    metrics: {
      memberCount: normalizeCount(metrics['memberCount']),
      postCount: normalizeCount(metrics['postCount']),
      mediaCount: normalizeCount(metrics['mediaCount']),
    },
    access: {
      join:
        join === 'open' || join === 'invite_only' ? join : 'approval',
      minimumRole:
        minimumRole === 'basic'
        || minimumRole === 'premium'
        || minimumRole === 'vip'
          ? minimumRole
          : null,
      requiresActiveSubscription:
        access['requiresActiveSubscription'] === true,
    },
  };
}

export function normalizeCommunityDiscoveryPageResponse(
  raw: unknown
): CommunityDiscoveryPage {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawCursor = normalizeSafeId(source['nextCursor']);
  const generatedAt = Number(source['generatedAt']);

  return {
    items: Array.isArray(source['items'])
      ? source['items']
          .map(normalizeCard)
          .filter((item): item is CommunityPreviewCard => item !== null)
      : [],
    nextCursor: rawCursor,
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
  };
}

export function normalizeCommunityPreviewResponse(
  raw: unknown
): CommunityPreviewResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const community = normalizeCard(source['community']);
  const viewerMode = source['viewerMode'];
  const generatedAt = Number(source['generatedAt']);

  if (
    !community
    || (viewerMode !== 'visitor'
      && viewerMode !== 'pending'
      && viewerMode !== 'member'
      && viewerMode !== 'moderator'
      && viewerMode !== 'manager')
  ) {
    return null;
  }

  return {
    community,
    viewerMode,
    canInteract: source['canInteract'] === true,
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
  };
}
