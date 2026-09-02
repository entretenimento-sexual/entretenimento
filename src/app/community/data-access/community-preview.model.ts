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
  type CommunityOfficialAssociationPublic,
  normalizeCommunityOfficialAssociationPublic,
} from 'src/app/core/community/community-official-association.model';
import {
  CommunityCapacityPreview,
  normalizeCommunityCapacityPreview,
} from './community-capacity.model';
import type { CommunityTagCategory } from './community-tag.model';
import {
  CommunityEditableSettings,
  normalizeCommunityEditableSettings,
} from './community-settings.model';

export type CommunityPreviewSourceType = 'community' | 'venue';
export type CommunityPreviewJoinPolicy = 'open' | 'approval' | 'invite_only';
export type CommunityPreviewViewerMode =
  | 'visitor'
  | 'pending'
  | 'member'
  | 'moderator'
  | 'manager';
export type CommunityPreviewViewerRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member';
export type CommunityPreviewMinimumRole = 'basic' | 'premium' | 'vip';
export type CommunityPreviewLifecycleStatus =
  | 'active'
  | 'paused'
  | 'dormant'
  | 'archived'
  | 'scheduled_for_deletion';

export interface CommunityPreviewTag {
  id: string;
  label: string;
  category: CommunityTagCategory;
}

export interface CommunityPreviewPublicLocation {
  readonly uf: string;
  readonly city: string;
  readonly district: string | null;
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
  /** Localização pública coarse; nunca inclui endereço preciso ou coordenadas. */
  publicLocation?: CommunityPreviewPublicLocation | null;
  /** Projeção pública derivada da associação oficial canônica. */
  officialAssociation?: CommunityOfficialAssociationPublic | null;
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
const SAFE_DISCOVERY_CURSOR_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;
const BRAZILIAN_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
]);

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

function normalizeDiscoveryCursor(value: unknown): string | null {
  const normalized = normalizeText(value, 192);
  return SAFE_DISCOVERY_CURSOR_PATTERN.test(normalized) ? normalized : null;
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
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeLifecycleStatus(
  value: unknown
): CommunityPreviewLifecycleStatus | null {
  return value === 'active'
    || value === 'paused'
    || value === 'dormant'
    || value === 'archived'
    || value === 'scheduled_for_deletion'
    ? value
    : null;
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

function normalizePublicLocation(
  raw: unknown
): CommunityPreviewPublicLocation | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const uf = normalizeText(source['uf'], 2).toUpperCase();
  const city = normalizeText(source['city'], 80);
  const district = normalizeText(source['district'], 80);

  if (!BRAZILIAN_UFS.has(uf) || city.length < 1) {
    return null;
  }

  return {
    uf,
    city,
    district: district || null,
  };
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
    || (sourceType !== 'community' && sourceType !== 'venue')
    || name.length < 2
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    return null;
  }

  const description = normalizeText(source['description'], 240);
  const join = access['join'];
  const viewerRole = normalizeViewerRole(source['viewerRole']);
  const publicLocation = sourceType === 'venue'
    ? normalizePublicLocation(source['publicLocation'])
    : null;
  const officialAssociation = normalizeCommunityOfficialAssociationPublic(
    source['officialAssociation']
  );

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
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: normalizeTags(source['tags']),
    ...(publicLocation ? { publicLocation } : {}),
    ...(officialAssociation ? { officialAssociation } : {}),
    ...(viewerRole ? { viewerRole } : {}),
  };
}

export function normalizeCommunityDiscoveryPageResponse(
  raw: unknown
): CommunityDiscoveryPage {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawCursor = normalizeDiscoveryCursor(source['nextCursor']);
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
  const capacity = community?.source.type === 'community'
    ? normalizeCommunityCapacityPreview(source['capacity'])
    : null;

  if (
    !community
    || (viewerMode !== 'visitor'
      && viewerMode !== 'pending'
      && viewerMode !== 'member'
      && viewerMode !== 'moderator'
      && viewerMode !== 'manager')
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
