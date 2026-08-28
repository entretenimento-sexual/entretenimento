// src/app/community/data-access/community-tag.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY TAG CLIENT CONTRACTS
// -----------------------------------------------------------------------------
// O catálogo autoritativo vem das Functions. O cliente apenas normaliza a
// projeção recebida e nunca inventa IDs locais.
// -----------------------------------------------------------------------------

export type CommunityTagCategory = 'intent' | 'practice' | 'audience';

export interface CommunityTagDefinition {
  id: string;
  label: string;
  category: CommunityTagCategory;
}

export interface CommunityTagCatalog {
  items: readonly CommunityTagDefinition[];
  generatedAt: number;
}

export const MIN_COMMUNITY_TAGS = 1;
export const MAX_COMMUNITY_TAGS = 6;

const SAFE_TAG_ID_PATTERN = /^(intent|practice|audience):[a-z0-9_]{1,64}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Normalizador público para filtros/URLs. A UI pode transportar somente IDs que
 * pertencem ao mesmo contrato seguro aceito pelo catálogo; rótulos continuam
 * vindo exclusivamente da projeção autoritativa.
 */
export function normalizeCommunityTagId(value: unknown): string | null {
  const id = normalizeText(value, 80);
  return SAFE_TAG_ID_PATTERN.test(id) ? id : null;
}

function normalizeTag(raw: unknown): CommunityTagDefinition | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const id = normalizeCommunityTagId(source['id']);
  const label = normalizeText(source['label'], 80);
  const category = source['category'];

  if (
    !id
    || label.length < 2
    || (category !== 'intent'
      && category !== 'practice'
      && category !== 'audience')
  ) {
    return null;
  }

  return { id, label, category };
}

export function normalizeCommunityTagCatalog(raw: unknown): CommunityTagCatalog {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = Number(source['generatedAt']);
  const items = Array.isArray(source['items'])
    ? source['items']
        .map(normalizeTag)
        .filter((tag): tag is CommunityTagDefinition => tag !== null)
    : [];
  const unique = new Map(items.map((tag) => [tag.id, tag] as const));

  return {
    items: [...unique.values()],
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
  };
}
