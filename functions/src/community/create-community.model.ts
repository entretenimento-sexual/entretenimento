// functions/src/community/create-community.model.ts
// -----------------------------------------------------------------------------
// CREATE COMMUNITY CONTRACT
// -----------------------------------------------------------------------------
// Comunidade é um grupo permanente de pessoas unidas por interesse, identidade,
// região ou objetivo. O cliente informa apenas conteúdo editorial e políticas de
// entrada/acesso; identificadores, propriedade, moderação e métricas pertencem ao
// backend.
// -----------------------------------------------------------------------------

export type CreateCommunityTheme =
  | 'regional'
  | 'interests'
  | 'identity'
  | 'events'
  | 'lifestyle'
  | 'other';

export type CreateCommunityJoinPolicy = 'open' | 'approval';
export type CreateCommunityAccessTier = 'all' | 'premium' | 'vip';

export interface CreateCommunityRequest {
  requestId?: unknown;
  name?: unknown;
  theme?: unknown;
  description?: unknown;
  rules?: unknown;
  joinPolicy?: unknown;
  accessTier?: unknown;
}

export interface NormalizedCreateCommunityRequest {
  requestId: string;
  communityId: string;
  name: string;
  slug: string;
  theme: CreateCommunityTheme;
  description: string | null;
  rules: string;
  joinPolicy: CreateCommunityJoinPolicy;
  accessTier: CreateCommunityAccessTier;
}

export interface CreateCommunityResponse {
  communityId: string;
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

function normalizeAccessTier(value: unknown): CreateCommunityAccessTier {
  return value === 'premium' || value === 'vip' ? value : 'all';
}

export function normalizeCreateCommunityRequest(
  raw: CreateCommunityRequest | null | undefined
): NormalizedCreateCommunityRequest | null {
  const requestId = normalizeText(raw?.requestId, 64);
  const name = normalizeText(raw?.name, 80);
  const theme = normalizeTheme(raw?.theme);
  const description = normalizeOptionalText(raw?.description, 240);
  const rules = normalizeMultilineText(raw?.rules, 1_200);
  const joinPolicy: CreateCommunityJoinPolicy =
    raw?.joinPolicy === 'open' ? 'open' : 'approval';
  const accessTier = normalizeAccessTier(raw?.accessTier);
  const slug = normalizeSlug(name);

  if (
    !REQUEST_ID_PATTERN.test(requestId)
    || name.length < 2
    || !theme
    || rules.length < 10
    || slug.length < 2
  ) {
    return null;
  }

  return {
    requestId,
    communityId: `community-${requestId}`,
    name,
    slug,
    theme,
    description,
    rules,
    joinPolicy,
    accessTier,
  };
}
