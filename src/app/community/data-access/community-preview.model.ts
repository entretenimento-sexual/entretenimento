// src/app/community/data-access/community-preview.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY PREVIEW CLIENT CONTRACTS
// -----------------------------------------------------------------------------
// O frontend normaliza novamente toda resposta das callables.
//
// Domínios aceitos nesta projeção:
// - `community`: grupo permanente de pessoas;
// - `venue`: Local físico com superfície social vinculada.
//
// Sala não faz parte deste contrato. Salas são espaços de conversa e ficam no
// domínio `/chat/rooms`.
// -----------------------------------------------------------------------------

import {
  isCommunityJoinPolicy,
  isCommunityLifecycleStatus,
  isCommunitySourceType,
  isCommunityViewerMode,
  isCommunityViewerRole,
} from './community-contract.generated';
import type {
  CommunityJoinPolicy,
  CommunityLifecycleStatus,
  CommunitySourceType,
  CommunityViewerMode,
  CommunityViewerRole,
} from './community-contract.generated';
import {
  CommunityCapacityPreview,
  normalizeCommunityCapacityPreview,
} from './community-capacity.model';
import type { CommunityTagCategory } from './community-tag.model';
import {
  CommunityEditableSettings,
  normalizeCommunityEditableSettings,
} from './community-settings.model';

export type CommunityPreviewSourceType = CommunitySourceType;
export type CommunityPreviewJoinPolicy = CommunityJoinPolicy;
export type CommunityPreviewViewerMode = CommunityViewerMode;
export type CommunityPreviewViewerRole = CommunityViewerRole;
export type CommunityPreviewMinimumRole = 'basic' | 'premium' | 'vip';
export type CommunityPreviewLifecycleStatus = CommunityLifecycleStatus;

export interface CommunityPreviewTag {
  id: string;
  label: string;
  category: CommunityTagCategory;
}

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
  tags: readonly CommunityPreviewTag[];
  /** Presente apenas nas respostas privadas de Comunidades do próprio viewer. */
  viewerRole?: CommunityPreviewViewerRole | null;
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
  tagId?: string | null;
}

export interface CommunityPreviewResponse {
  community: CommunityPreviewCard;
  rules: string | null;
  lifecycleStatus: CommunityPreviewLifecycleStatus | null;
  viewerMode: CommunityPreviewViewerMode;
  viewerRole: CommunityPreviewViewerRole | null;
  canInteract: boolean;
  canManageMemberships: boolean;
  canInviteCommunityMembers: boolean;
  canManageCommunitySettings: boolean;
  capacity: CommunityCapacityPreview | null;
  settings: CommunityEditableSettings | null;
  canLeaveMembership: boolean;
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeMultilineText(value: unknown, maxLength: number): string {
  return [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join('')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxLength)
    .trim();
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

function normalizeViewerRole(
  value: unknown
): CommunityPreviewViewerRole | null {
  return isCommunityViewerRole(value) ? value : null;
}

function normalizeLifecycleStatus(
  value: unknown
): CommunityPreviewLifecycleStatus | null {
  return isCommunityLifecycleStatus(value) ? value : null;
}

function normalizeTagCategory(value: unknown): CommunityTagCategory | null {
  return value === 'intent' || value === 'practice' || value === 'audience'
    ? value
    : null;
}

function normalizeTags(raw: unknown): readonly CommunityPreviewTag[] {
  if (!Array.isArray(raw)) return [];

  const tags = new Map<string, CommunityPreviewTag>();

  for (const rawTag of raw.slice(0, 12)) {
    const source = (rawTag ?? {}) as Record<string, unknown>;
    const id = normalizeSafeId(source['id']);
    const label = normalizeText(source['label'], 48);
    const category = normalizeTagCategory(source['category']);

    if (!id || !label || !category) continue;
    tags.set(id, { id, label, category });
    if (tags.size >= 6) break;
  }

  return [...tags.values()];
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
    || !isCommunitySourceType(sourceType)
    || name.length < 2
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    return null;
  }

  const description = normalizeText(source['description'], 240);
  const join = access['join'];
  const viewerRole = normalizeViewerRole(source['viewerRole']);

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
      join: isCommunityJoinPolicy(join) ? join : 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: normalizeTags(source['tags']),
    ...(viewerRole ? { viewerRole } : {}),
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
  const lifecycleStatus = normalizeLifecycleStatus(source['lifecycleStatus']);
  const canManageCommunitySettings =
    community?.source.type === 'community'
    && source['canManageCommunitySettings'] === true;
  const settings = canManageCommunitySettings
    ? normalizeCommunityEditableSettings(source['settings'])
    : null;
  const rawCapacity = source['capacity'];
  const capacity = community?.source.type === 'community'
    ? normalizeCommunityCapacityPreview(rawCapacity)
      ?? (rawCapacity === undefined && community
        ? {
          configuredLimit: 25,
          effectiveLimit: 25,
          memberCount: community.metrics.memberCount,
          acceptingNewMembers: community.metrics.memberCount < 25,
          restrictedByOwnerPlan: false,
          allowedMemberLimits: [],
        }
        : null)
    : null;

  if (
    !community
    || !isCommunityViewerMode(viewerMode)
    || (community.source.type === 'community' && !lifecycleStatus)
    || (canManageCommunitySettings && !settings)
    || (community.source.type === 'community' && !capacity)
  ) {
    return null;
  }

  return {
    community,
    rules: community.source.type === 'community'
      ? normalizeMultilineText(source['rules'], 1_200) || null
      : null,
    lifecycleStatus: community.source.type === 'community'
      ? lifecycleStatus
      : null,
    viewerMode,
    viewerRole: normalizeViewerRole(source['viewerRole']),
    canInteract: source['canInteract'] === true,
    canManageMemberships: source['canManageMemberships'] === true,
    canInviteCommunityMembers: source['canInviteCommunityMembers'] === true,
    canManageCommunitySettings,
    capacity,
    settings,
    canLeaveMembership: source['canLeaveMembership'] === true,
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
  };
}
