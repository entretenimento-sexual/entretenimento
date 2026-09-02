// functions/src/community/community-discovery-exposure.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY QUALIFIED EXPOSURE POLICY
// -----------------------------------------------------------------------------
// Contrato puro da telemetria agregada de visibilidade real do Explorar.
// Não modela usuário, sessão, impressão bruta, clique ou histórico de navegação.
// O cliente só informa IDs que qualificaram visibilidade; o backend revalida
// cada projeção antes de incrementar contadores diários fragmentados.
// -----------------------------------------------------------------------------

export const COMMUNITY_DISCOVERY_EXPOSURE_BATCH_SIZE = 12;
export const COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS = 8;
export const COMMUNITY_DISCOVERY_EXPOSURE_BURST_MAX_BATCHES = 30;
export const COMMUNITY_DISCOVERY_EXPOSURE_BURST_WINDOW_MS = 5 * 60 * 1_000;
export const COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_MAX_BATCHES = 120;
export const COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_WINDOW_MS = 60 * 60 * 1_000;

export type CommunityDiscoveryExposureSourceType = 'community' | 'venue';

export interface CommunityDiscoveryExposureRequest {
  sourceType?: unknown;
  communityIds?: unknown;
}

export interface NormalizedCommunityDiscoveryExposureRequest {
  sourceType: CommunityDiscoveryExposureSourceType;
  communityIds: readonly string[];
}

const SAFE_COMMUNITY_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export function normalizeCommunityDiscoveryExposureRequest(
  raw: CommunityDiscoveryExposureRequest | null | undefined
): NormalizedCommunityDiscoveryExposureRequest | null {
  const sourceType = raw?.sourceType === 'community' || raw?.sourceType === 'venue'
    ? raw.sourceType
    : null;
  const sourceIds = Array.isArray(raw?.communityIds) ? raw.communityIds : null;

  if (
    !sourceType
    || !sourceIds
    || sourceIds.length < 1
    || sourceIds.length > COMMUNITY_DISCOVERY_EXPOSURE_BATCH_SIZE
  ) {
    return null;
  }

  const communityIds: string[] = [];
  const seen = new Set<string>();

  for (const rawId of sourceIds) {
    const communityId = String(rawId ?? '').trim();
    if (!SAFE_COMMUNITY_ID_PATTERN.test(communityId)) return null;
    if (seen.has(communityId)) continue;
    seen.add(communityId);
    communityIds.push(communityId);
  }

  return communityIds.length > 0
    ? { sourceType, communityIds }
    : null;
}

export function isCommunityDiscoveryExposureEligibleProjection(
  raw: unknown,
  expectedSourceType: CommunityDiscoveryExposureSourceType
): boolean {
  const projection = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const source = projection['source'] && typeof projection['source'] === 'object'
    && !Array.isArray(projection['source'])
    ? projection['source'] as Record<string, unknown>
    : {};

  return projection['status'] === 'active'
    && projection['moderationState'] === 'active'
    && projection['visibility'] === 'public_preview'
    && source['type'] === expectedSourceType;
}

export function resolveCommunityDiscoveryExposureDay(now: number): string {
  const safeNow = Number.isFinite(now) && now > 0 ? Math.trunc(now) : Date.now();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(safeNow));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function normalizeCommunityDiscoveryExposureShard(
  value: unknown
): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(
    Math.max(parsed, 0),
    COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS - 1
  );
}
