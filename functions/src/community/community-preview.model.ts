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

import {
  CommunityTagCategory,
  isCommunityTagId,
  resolveCommunityTagDefinitions,
} from './community-tag.catalog';
import type { CommunityLifecycleStatus } from './community-lifecycle.policy';
import type { CommunityEditableSettings } from './community-settings.model';
import type {
  CommunityEffectiveMemberLimit,
  CommunityMemberLimit,
  CommunityMemberLimitCapabilityOption,
} from './community-capacity.policy';
import {
  type CommunityOfficialAssociationPublicProjection,
  normalizeCommunityOfficialAssociationPublicProjection,
} from './community-official-association.model';
import {
  type CommunityPublicLocation,
  normalizeCommunityPublicLocation,
} from './community-public-location.model';

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
export type CommunityPreviewLifecycleStatus = CommunityLifecycleStatus;

export interface CommunityDiscoveryPageRequest {
  limit?: unknown;
  cursor?: unknown;
  sourceType?: unknown;
  tagId?: unknown;
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
    type: CommunitySourceType;
    id: string;
  };
  avatarUrl: string | null;
  coverUrl: string | null;
  metrics: CommunityPreviewMetrics;
  access: CommunityPreviewAccess;
  tags: readonly CommunityPreviewTag[];
  /** Localização pública coarse; nunca inclui endereço preciso ou coordenadas. */
  publicLocation?: CommunityPublicLocation | null;
  /** Projeção pública derivada da associação oficial canônica. */
  officialAssociation?: CommunityOfficialAssociationPublicProjection | null;
  /** Presente apenas em projeções privadas ligadas ao membership do viewer. */
  viewerRole?: CommunityViewerRole | null;
}

export interface CommunityDiscoveryPageResponse {
  items: CommunityPreviewCard[];
  nextCursor: string | null;
  generatedAt: number;
}

export interface CommunityPreviewResponse {
  community: CommunityPreviewCard;
  /** Regras editoriais da Comunidade; Locais não participam deste contrato. */
  rules: string | null;
  /** Lifecycle explícito do backend; Locais não participam deste contrato. */
  lifecycleStatus: CommunityPreviewLifecycleStatus | null;
  viewerMode: CommunityViewerMode;
  viewerRole: CommunityViewerRole | null;
  canInteract: boolean;
  canManageMemberships: boolean;
  canInviteCommunityMembers: boolean;
  canManageCommunitySettings: boolean;
  capacity: {
    configuredLimit: CommunityMemberLimit;
    effectiveLimit: CommunityEffectiveMemberLimit;
    memberCount: number;
    acceptingNewMembers: boolean;
    restrictedByOwnerPlan: boolean;
    memberLimitOptions: readonly CommunityMemberLimitCapabilityOption[];
    /** Compatibilidade temporária com consumidores anteriores. */
    allowedMemberLimits: readonly CommunityMemberLimit[];
  } | null;
  /** Configurações privadas, somente quando a capability acima for verdadeira. */
  settings: CommunityEditableSettings | null;
  canLeaveMembership: boolean;
  generatedAt: number;
}

export interface CommunityPreviewDetails {
  rules: string | null;
  lifecycleStatus: CommunityPreviewLifecycleStatus | null;
}

export interface NormalizedCommunityDiscoveryPageRequest {
  limit: number;
  cursor: string | null;
  sourceType: CommunitySourceType | null;
  tagId: string | null;
}

const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 24;
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_DISCOVERY_CURSOR_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
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

function normalizeTagId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return normalized && isCommunityTagId(normalized) ? normalized : null;
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

function normalizeAccess(raw: unknown): CommunityPreviewAccess {
  const source = (raw ?? {}) as Record<string, unknown>;

  return {
    join: normalizeJoin(source['join']),
    minimumRole: null,
    requiresActiveSubscription: false,
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

function normalizeTags(raw: unknown): readonly CommunityPreviewTag[] {
  return resolveCommunityTagDefinitions(raw).map(({ id, label, category }) => ({
    id,
    label,
    category,
  }));
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
  const publicLocation = communitySource.type === 'venue'
    ? normalizeCommunityPublicLocation(source['publicLocation'])
    : null;
  const officialAssociation =
    normalizeCommunityOfficialAssociationPublicProjection(
      source['officialAssociation']
    );

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
    tags: communitySource.type === 'community'
      ? normalizeTags(source['tagIds'])
      : [],
    ...(publicLocation ? { publicLocation } : {}),
    ...(officialAssociation ? { officialAssociation } : {}),
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
    cursor: normalizeDiscoveryCursor(raw?.cursor),
    sourceType: normalizeSourceType(raw?.sourceType),
    tagId: normalizeTagId(raw?.tagId),
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
  const status = source['status'];
  const validStatus = status === 'active'
    || status === 'paused'
    || status === 'dormant'
    || status === 'archived'
    || status === 'scheduled_for_deletion';
  const terminalStatus = status === 'archived' || status === 'scheduled_for_deletion';
  const validVisibility = source['visibility'] === 'public_preview'
    || source['visibility'] === 'members_only'
    || (terminalStatus && source['visibility'] === 'hidden');

  if (
    !validStatus
    || moderation['state'] !== 'active'
    || !validVisibility
  ) {
    return null;
  }

  return buildPreviewCard(documentId, source);
}

/**
 * Sanitiza somente os campos adicionais da página autenticada. Eles não fazem
 * parte do card de descoberta e, portanto, não podem vazar por aquela projeção.
 */
export function sanitizeCommunityPreviewDetails(
  raw: unknown
): CommunityPreviewDetails | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const sourceData = (source['source'] ?? {}) as Record<string, unknown>;
  const sourceType = normalizeSourceType(sourceData['type']);

  if (!sourceType) return null;
  if (sourceType === 'venue') {
    return { rules: null, lifecycleStatus: null };
  }

  const lifecycleStatus = normalizeLifecycleStatus(source['status']);
  if (!lifecycleStatus) return null;

  const rules = normalizeMultilineText(source['rules'], 1_200);
  return {
    rules: rules || null,
    lifecycleStatus,
  };
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
