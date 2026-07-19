// functions/src/community/community-preview.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY PREVIEW CONTRACTS
// -----------------------------------------------------------------------------
// Contratos sanitizados para descoberta paginada e página comunitária somente
// leitura. Nenhum campo financeiro, privado ou de localização precisa é exposto.
//
// Definições de domínio preservadas neste contrato:
// - `community`: grupo permanente de pessoas com membros, regras e mural;
// - `venue`: Local físico que reutiliza infraestrutura social internamente;
// - Sala não é uma origem comunitária. Salas pertencem ao domínio `/chat/rooms`.
// -----------------------------------------------------------------------------

export type CommunitySourceType = 'community' | 'venue';
export type CommunityJoinPolicy = 'open' | 'approval' | 'invite_only';
export type CommunityViewerMode =
  | 'visitor'
  | 'pending'
  | 'member'
  | 'moderator'
  | 'manager';
export type CommunityViewerRole = 'owner' | 'admin' | 'moderator' | 'member';
export type CommunityMinimumRole = 'basic' | 'premium' | 'vip';

export interface CommunityDiscoveryPageRequest {
  limit?: unknown;
  cursor?: unknown;
  sourceType?: unknown;
}

export interface CommunityPreviewRequest {
  communityId?: unknown;
}

export interface CommunityPreviewMetrics {
  memberCount: number;
  postCount: number;
  mediaCount: number;
}

export interface CommunityPreviewAccess {
  join: CommunityJoinPolicy;
  minimumRole: CommunityMinimumRole | null;
  requiresActiveSubscription: boolean;
}

export interface CommunityPreviewCard {
  communityId: string;
  name: string;
  slug: string;
  description: string | null;
  source: {
    type: CommunitySourceType;
    id: string;
  };
  avatarUrl: string | null;
  coverUrl: string | null;
  metrics: CommunityPreviewMetrics;
  access: CommunityPreviewAccess;
}

export interface CommunityDiscoveryPageResponse {
  items: CommunityPreviewCard[];
  nextCursor: string | null;
  generatedAt: number;
}

export interface CommunityPreviewResponse {
  community: CommunityPreviewCard;
  viewerMode: CommunityViewerMode;
  viewerRole: CommunityViewerRole | null;
  canInteract: boolean;
  generatedAt: number;
}

export interface NormalizedCommunityDiscoveryPageRequest {
  limit: number;
  cursor: string | null;
  sourceType: CommunitySourceType | null;
}

const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 24;
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

function normalizeSourceType(value: unknown): CommunitySourceType | null {
  return value === 'community' || value === 'venue' ? value : null;
}

function normalizeViewerRole(value: unknown): CommunityViewerRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeSource(raw: unknown): CommunityPreviewCard['source'] | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const type = normalizeSourceType(source['type']);
  const id = normalizeSafeId(source['id']);

  if (!type || !id) {
    return null;
  }

  return { type, id };
}

function normalizeJoin(value: unknown): CommunityJoinPolicy {
  return value === 'open' || value === 'invite_only' ? value : 'approval';
}

function normalizeMinimumRole(value: unknown): CommunityMinimumRole | null {
  return value === 'basic' || value === 'premium' || value === 'vip'
    ? value
    : null;
}

function normalizeAccess(raw: unknown): CommunityPreviewAccess {
  const source = (raw ?? {}) as Record<string, unknown>;
  const contentAccess = (source['contentAccess'] ?? {}) as Record<string, unknown>;

  return {
    join: normalizeJoin(source['join']),
    minimumRole: normalizeMinimumRole(contentAccess['minimumRole']),
    requiresActiveSubscription:
      contentAccess['requiresActiveSubscription'] === true,
  };
}

function normalizeMetrics(raw: unknown): CommunityPreviewMetrics {
  const source = (raw ?? {}) as Record<string, unknown>;

  return {
    memberCount: normalizeCount(source['memberCount']),
    postCount: normalizeCount(source['postCount']),
    mediaCount: normalizeCount(source['mediaCount']),
  };
}

function buildPreviewCard(
  communityIdRaw: unknown,
  raw: unknown
): CommunityPreviewCard | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(communityIdRaw);
  const name = normalizeText(source['name'], 80);
  const slug = normalizeText(source['slug'], 100);
  const communitySource = normalizeSource(source['source']);

  if (
    !communityId
    || name.length < 2
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    || !communitySource
  ) {
    return null;
  }

  const description = normalizeText(source['description'], 240);

  return {
    communityId,
    name,
    slug,
    description: description || null,
    source: communitySource,
    avatarUrl: normalizeHttpsUrl(source['avatarUrl']),
    coverUrl: normalizeHttpsUrl(source['coverUrl']),
    metrics: normalizeMetrics(source['metrics']),
    access: normalizeAccess(source['access']),
  };
}

export function normalizeCommunityDiscoveryPageRequest(
  raw: CommunityDiscoveryPageRequest | null | undefined
): NormalizedCommunityDiscoveryPageRequest {
  const parsedLimit = Math.trunc(Number(raw?.limit));
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;

  return {
    limit,
    cursor: normalizeSafeId(raw?.cursor),
    sourceType: normalizeSourceType(raw?.sourceType),
  };
}

export function normalizeCommunityId(value: unknown): string | null {
  return normalizeSafeId(value);
}

export function sanitizeCommunityDiscoveryProjection(
  documentId: string,
  raw: unknown
): CommunityPreviewCard | null {
  const source = (raw ?? {}) as Record<string, unknown>;

  if (
    source['status'] !== 'active'
    || source['moderationState'] !== 'active'
    || source['visibility'] !== 'public_preview'
  ) {
    return null;
  }

  return buildPreviewCard(documentId, source);
}

export function sanitizeCommunityDocument(
  documentId: string,
  raw: unknown
): CommunityPreviewCard | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const moderation = (source['moderation'] ?? {}) as Record<string, unknown>;
  const validStatus = source['status'] === 'active' || source['status'] === 'paused';

  if (
    !validStatus
    || moderation['state'] !== 'active'
    || (source['visibility'] !== 'public_preview'
      && source['visibility'] !== 'members_only')
  ) {
    return null;
  }

  return buildPreviewCard(documentId, source);
}

export function resolveCommunityViewerMode(rawMembership: unknown): {
  mode: CommunityViewerMode;
  role: CommunityViewerRole | null;
  active: boolean;
  blocked: boolean;
} {
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const status = membership['status'];
  const role = normalizeViewerRole(membership['role']);

  if (status === 'blocked') {
    return { mode: 'visitor', role: null, active: false, blocked: true };
  }

  if (status === 'pending') {
    return { mode: 'pending', role, active: false, blocked: false };
  }

  if (status !== 'active') {
    return { mode: 'visitor', role: null, active: false, blocked: false };
  }

  if (role === 'owner' || role === 'admin') {
    return { mode: 'manager', role, active: true, blocked: false };
  }

  if (role === 'moderator') {
    return { mode: 'moderator', role, active: true, blocked: false };
  }

  return { mode: 'member', role, active: true, blocked: false };
}
