// functions/src/community/community-search-text.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY SEARCH TEXT POLICY
// -----------------------------------------------------------------------------
// Normalização canônica compartilhada pela busca interna de Comunidades.
// Mantém a mesma semântica para índice de membros e Discussões sem transformar
// a projeção de busca em fonte de autorização.
// -----------------------------------------------------------------------------

export const COMMUNITY_SEARCH_MIN_QUERY_LENGTH = 2;
export const COMMUNITY_SEARCH_MAX_QUERY_LENGTH = 40;
export const COMMUNITY_SEARCH_MAX_PREFIXES = 64;

function normalizeDisplayText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeCommunitySearchText(value: unknown): string {
  return normalizeDisplayText(value, COMMUNITY_SEARCH_MAX_QUERY_LENGTH)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCommunitySearchQuery(value: unknown): string | null {
  const raw = normalizeDisplayText(value, COMMUNITY_SEARCH_MAX_QUERY_LENGTH);
  if (!raw) return '';

  const normalized = normalizeCommunitySearchText(raw);
  return normalized.length >= COMMUNITY_SEARCH_MIN_QUERY_LENGTH
    && normalized.length <= COMMUNITY_SEARCH_MAX_QUERY_LENGTH
    ? normalized
    : null;
}

function buildPrefixes(value: string): string[] {
  if (value.length < COMMUNITY_SEARCH_MIN_QUERY_LENGTH) return [];

  const prefixes: string[] = [];
  const maxLength = Math.min(value.length, COMMUNITY_SEARCH_MAX_QUERY_LENGTH);

  for (
    let length = COMMUNITY_SEARCH_MIN_QUERY_LENGTH;
    length <= maxLength;
    length += 1
  ) {
    prefixes.push(value.slice(0, length));
  }

  return prefixes;
}

export function buildCommunitySearchPrefixes(
  ...values: readonly unknown[]
): readonly string[] {
  const candidates: string[] = [];

  for (const value of values) {
    const normalized = normalizeCommunitySearchText(value);
    if (!normalized) continue;

    candidates.push(...buildPrefixes(normalized));
    candidates.push(
      ...normalized
        .split(' ')
        .filter(Boolean)
        .flatMap((token) => buildPrefixes(token))
    );
  }

  return Array.from(new Set(candidates))
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
    .slice(0, COMMUNITY_SEARCH_MAX_PREFIXES);
}
