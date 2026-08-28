// functions/src/community/community-settings.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY SETTINGS CONTRACT
// -----------------------------------------------------------------------------
// Somente campos editoriais e políticas configuráveis atravessam a callable.
// Propriedade, métricas, lifecycle, moderação e ranking permanecem autoritativos.
// -----------------------------------------------------------------------------

import { normalizeNewCommunityTagIds } from './community-tag.catalog';
import {
  CommunityMemberLimit,
  normalizeCommunityMemberLimit,
  resolveCommunityConfiguredMemberLimit,
} from './community-capacity.policy';

export type CommunitySettingsJoinPolicy =
  | 'open'
  | 'approval'
  | 'invite_only';
export type CommunitySettingsAccessTier = 'all';

export interface CommunityEditableSettings {
  name: string;
  description: string | null;
  rules: string;
  joinPolicy: CommunitySettingsJoinPolicy;
  accessTier: CommunitySettingsAccessTier;
  membersCanInvite: boolean;
  memberLimit: CommunityMemberLimit;
  tagIds: string[];
}

export interface UpdateCommunitySettingsRequest {
  requestId?: unknown;
  communityId?: unknown;
  name?: unknown;
  description?: unknown;
  rules?: unknown;
  joinPolicy?: unknown;
  accessTier?: unknown;
  membersCanInvite?: unknown;
  memberLimit?: unknown;
  tagIds?: unknown;
}

export interface NormalizedUpdateCommunitySettingsRequest
  extends CommunityEditableSettings {
  requestId: string;
  communityId: string;
  slug: string;
}

export interface UpdateCommunitySettingsResponse {
  communityId: string;
  updated: boolean;
  changedFields: string[];
  generatedAt: number;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function stripControlCharacters(
  value: unknown,
  preserveMultilineWhitespace = false
): string {
  return [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);

      if (code === 127) return false;
      if (code >= 32) return true;

      return preserveMultilineWhitespace
        && (code === 9 || code === 10 || code === 13);
    })
    .join('');
}

function normalizeText(value: unknown, maxLength: number): string {
  return stripControlCharacters(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  const normalized = normalizeText(value, maxLength);
  return normalized || null;
}

function normalizeMultilineText(value: unknown, maxLength: number): string {
  return stripControlCharacters(value, true)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxLength)
    .trim();
}

export function buildCommunitySlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 72)
    .replace(/-+$/g, '');
}

function normalizeJoinPolicy(
  value: unknown
): CommunitySettingsJoinPolicy | null {
  return value === 'open'
    || value === 'approval'
    || value === 'invite_only'
    ? value
    : null;
}

export function normalizeUpdateCommunitySettingsRequest(
  raw: UpdateCommunitySettingsRequest | null | undefined
): NormalizedUpdateCommunitySettingsRequest | null {
  const requestId = normalizeText(raw?.requestId, 64);
  const communityId = normalizeText(raw?.communityId, 128);
  const name = normalizeText(raw?.name, 80);
  const description = normalizeOptionalText(raw?.description, 240);
  const rules = normalizeMultilineText(raw?.rules, 1_200);
  const joinPolicy = normalizeJoinPolicy(raw?.joinPolicy);
  // Clientes antigos podem continuar enviando `accessTier`, mas a plataforma
  // não transforma participação em benefício de assinatura.
  const accessTier: CommunitySettingsAccessTier = 'all';
  const membersCanInvite = raw?.membersCanInvite;
  const memberLimit = normalizeCommunityMemberLimit(raw?.memberLimit);
  const tagIds = normalizeNewCommunityTagIds(raw?.tagIds);
  const slug = buildCommunitySlug(name);

  if (
    !REQUEST_ID_PATTERN.test(requestId)
    || !COMMUNITY_ID_PATTERN.test(communityId)
    || name.length < 2
    || rules.length < 10
    || slug.length < 2
    || !joinPolicy
    || typeof membersCanInvite !== 'boolean'
    || !memberLimit
    || !tagIds
  ) {
    return null;
  }

  return {
    requestId,
    communityId,
    name,
    slug,
    description,
    rules,
    joinPolicy,
    accessTier,
    membersCanInvite,
    memberLimit,
    tagIds,
  };
}

export function sanitizeCommunityEditableSettings(
  raw: unknown
): CommunityEditableSettings | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const access = (source['access'] ?? {}) as Record<string, unknown>;
  const invites = (access['invites'] ?? {}) as Record<string, unknown>;
  const name = normalizeText(source['name'], 80);
  const description = normalizeOptionalText(source['description'], 240);
  const rules = normalizeMultilineText(source['rules'], 1_200);
  const joinPolicy = normalizeJoinPolicy(access['join']);
  const accessTier: CommunitySettingsAccessTier = 'all';
  const tagIds = normalizeNewCommunityTagIds(source['tagIds']);
  const membersCanInvite = invites['membersCanInvite'] === true;
  const memberLimit = resolveCommunityConfiguredMemberLimit(source);

  if (
    name.length < 2
    || rules.length < 10
    || !joinPolicy
    || !tagIds
  ) {
    return null;
  }

  return {
    name,
    description,
    rules,
    joinPolicy,
    accessTier,
    membersCanInvite,
    memberLimit,
    tagIds,
  };
}

export function resolveCommunitySettingsChangedFields(
  current: CommunityEditableSettings,
  next: CommunityEditableSettings
): string[] {
  const changedFields: string[] = [];

  if (current.name !== next.name) changedFields.push('name');
  if (current.description !== next.description) changedFields.push('description');
  if (current.rules !== next.rules) changedFields.push('rules');
  if (current.joinPolicy !== next.joinPolicy) changedFields.push('joinPolicy');
  if (current.membersCanInvite !== next.membersCanInvite) {
    changedFields.push('membersCanInvite');
  }
  if (current.memberLimit !== next.memberLimit) {
    changedFields.push('memberLimit');
  }
  if (current.tagIds.join('\n') !== next.tagIds.join('\n')) {
    changedFields.push('tagIds');
  }

  return changedFields;
}
