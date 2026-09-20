// functions/src/community/create-official-community.model.ts
// -----------------------------------------------------------------------------
// CREATE OFFICIAL COMMUNITY CONTRACT
// -----------------------------------------------------------------------------
// O cliente descreve a Comunidade e escolhe somente o alvo oficial. Autoridade,
// sponsor, evidências, papel de autoridade e capacidade são derivados no backend.
// Assinatura pessoal e role comunitária não fazem parte deste contrato.
// -----------------------------------------------------------------------------

import {
  normalizeCanonicalAuthorityResourceId,
  normalizeCanonicalAuthorityTargetType,
} from '../authority/canonical-resource-authority.model';
import {
  buildCommunityOfficialAssociationKey,
  type CommunityOfficialTarget,
} from './community-official-association.model';
import { normalizeNewCommunityTagIds } from './community-tag.catalog';
import type {
  CreateCommunityJoinPolicy,
  CreateCommunityTheme,
} from './create-community.model';

export interface CreateOfficialCommunityRequest {
  requestId?: unknown;
  target?: unknown;
  name?: unknown;
  theme?: unknown;
  description?: unknown;
  rules?: unknown;
  joinPolicy?: unknown;
  tagIds?: unknown;
  declarationAccepted?: unknown;
}

export interface NormalizedCreateOfficialCommunityRequest {
  requestId: string;
  communityId: string;
  associationKey: string;
  target: CommunityOfficialTarget;
  name: string;
  slug: string;
  theme: CreateCommunityTheme;
  description: string | null;
  rules: string;
  joinPolicy: CreateCommunityJoinPolicy;
  tagIds: string[];
  declarationAccepted: true;
}

export interface CreateOfficialCommunityResponse {
  communityId: string;
  associationKey: string;
  target: CommunityOfficialTarget;
  created: boolean;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

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
  return normalizeText(value, maxLength) || null;
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

function normalizeSlug(value: string): string {
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

function normalizeTheme(value: unknown): CreateCommunityTheme | null {
  return value === 'regional'
    || value === 'interests'
    || value === 'identity'
    || value === 'events'
    || value === 'lifestyle'
    || value === 'other'
    ? value
    : null;
}

function normalizeTarget(raw: unknown): CommunityOfficialTarget | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const type = normalizeCanonicalAuthorityTargetType(source['type']);
  const id = normalizeCanonicalAuthorityResourceId(source['id']);
  return type && id ? { type, id } : null;
}

export function normalizeCreateOfficialCommunityRequest(
  raw: CreateOfficialCommunityRequest | null | undefined
): NormalizedCreateOfficialCommunityRequest | null {
  const requestId = normalizeText(raw?.requestId, 64);
  const target = normalizeTarget(raw?.target);
  const name = normalizeText(raw?.name, 80);
  const theme = normalizeTheme(raw?.theme);
  const description = normalizeOptionalText(raw?.description, 240);
  const rules = normalizeMultilineText(raw?.rules, 1_200);
  const joinPolicy: CreateCommunityJoinPolicy =
    raw?.joinPolicy === 'open' ? 'open' : 'approval';
  const tagIds = normalizeNewCommunityTagIds(raw?.tagIds);
  const slug = normalizeSlug(name);

  if (
    !REQUEST_ID_PATTERN.test(requestId)
    || !target
    || name.length < 2
    || !theme
    || rules.length < 10
    || slug.length < 2
    || !tagIds
    || raw?.declarationAccepted !== true
  ) {
    return null;
  }

  const associationKey = buildCommunityOfficialAssociationKey(target);
  const communityId = normalizeCanonicalAuthorityResourceId(
    `official-community-${requestId}`
  );

  if (!associationKey || !communityId) return null;

  return {
    requestId,
    communityId,
    associationKey,
    target,
    name,
    slug,
    theme,
    description,
    rules,
    joinPolicy,
    tagIds,
    declarationAccepted: true,
  };
}
