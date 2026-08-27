// src/app/community/data-access/community-settings.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY SETTINGS - CLIENT CONTRACTS
// -----------------------------------------------------------------------------

import {
  CommunityMemberLimit,
  normalizeCommunityMemberLimit,
} from './community-capacity.model';

export type CommunitySettingsJoinPolicy =
  | 'open'
  | 'approval'
  | 'invite_only';

export interface CommunityEditableSettings {
  name: string;
  description: string | null;
  rules: string;
  joinPolicy: CommunitySettingsJoinPolicy;
  membersCanInvite: boolean;
  memberLimit: CommunityMemberLimit;
  tagIds: readonly string[];
}

export interface CommunitySettingsUpdateCommand
  extends CommunityEditableSettings {
  requestId: string;
  communityId: string;
}

export interface CommunitySettingsUpdateResult {
  communityId: string;
  updated: boolean;
  changedFields: readonly string[];
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_TAG_ID_PATTERN = /^(intent|practice|audience):[a-z0-9_]{1,64}$/;
const SAFE_CHANGED_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,47}$/;

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

function normalizeTagIds(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null;

  const tagIds = [...new Set(
    raw.map((value) => normalizeText(value, 80)).filter(Boolean)
  )];

  return tagIds.length >= 1
    && tagIds.length <= 6
    && tagIds.every((tagId) => SAFE_TAG_ID_PATTERN.test(tagId))
    ? tagIds
    : null;
}

export function normalizeCommunityEditableSettings(
  raw: unknown
): CommunityEditableSettings | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const name = normalizeText(source['name'], 80);
  const description = normalizeText(source['description'], 240);
  const rules = normalizeMultilineText(source['rules'], 1_200);
  const joinPolicy = source['joinPolicy'];
  const tagIds = normalizeTagIds(source['tagIds']);
  const memberLimit = normalizeCommunityMemberLimit(source['memberLimit']);

  if (
    name.length < 2
    || rules.length < 10
    || (joinPolicy !== 'open'
      && joinPolicy !== 'approval'
      && joinPolicy !== 'invite_only')
    || typeof source['membersCanInvite'] !== 'boolean'
    || !memberLimit
    || !tagIds
  ) {
    return null;
  }

  return {
    name,
    description: description || null,
    rules,
    joinPolicy,
    membersCanInvite: source['membersCanInvite'],
    memberLimit,
    tagIds,
  };
}

export function normalizeCommunitySettingsUpdateResult(
  raw: unknown
): CommunitySettingsUpdateResult | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const generatedAt = Number(source['generatedAt']);
  const changedFields = Array.isArray(source['changedFields'])
    ? [...new Set(
        source['changedFields']
          .map((field) => normalizeText(field, 48))
          .filter((field) => SAFE_CHANGED_FIELD_PATTERN.test(field))
      )]
    : null;

  if (!communityId || !Number.isFinite(generatedAt) || !changedFields) {
    return null;
  }

  return {
    communityId,
    updated: source['updated'] === true,
    changedFields,
    generatedAt,
  };
}
