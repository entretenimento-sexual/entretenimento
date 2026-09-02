// src/app/community/data-access/community-discovery.contract.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY CLIENT CONTRACT
// -----------------------------------------------------------------------------
// Espelho cliente do contrato aceito pelas callables de descoberta. O backend
// continua sendo a autoridade final; frontend, cache e repositories consomem
// estes mesmos limites para não criarem envelopes incompatíveis entre si.
// -----------------------------------------------------------------------------

export const DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE = 12;
export const MIN_COMMUNITY_DISCOVERY_PAGE_SIZE = 1;
export const MAX_COMMUNITY_DISCOVERY_PAGE_SIZE = 24;

export function normalizeCommunityDiscoveryPageSize(value: unknown): number {
  const parsed = Number(value);
  const size = Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE;

  return Math.min(
    MAX_COMMUNITY_DISCOVERY_PAGE_SIZE,
    Math.max(MIN_COMMUNITY_DISCOVERY_PAGE_SIZE, size)
  );
}
