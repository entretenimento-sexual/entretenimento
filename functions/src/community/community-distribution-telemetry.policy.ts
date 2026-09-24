// functions/src/community/community-distribution-telemetry.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISTRIBUTION TELEMETRY
// -----------------------------------------------------------------------------
// Eventos agregados das inserções de Comunidades no Explore social.
// O contrato deliberadamente não aceita UID, postId, sessão ou rota livre.
// Apenas Comunidade + superfície finita + evento finito atravessam a fronteira.
// -----------------------------------------------------------------------------

export const COMMUNITY_DISTRIBUTION_TELEMETRY_BATCH_SIZE = 12;

export type CommunityDistributionTelemetrySurface =
  | 'social_explore_recommendation'
  | 'social_explore_activity'
  | 'social_explore_content';

export type CommunityDistributionTelemetryEventType =
  | 'qualified_exposure'
  | 'open';

export interface CommunityDistributionTelemetryRequest {
  readonly events?: unknown;
}

export interface CommunityDistributionTelemetryEvent {
  readonly communityId: string;
  readonly surface: CommunityDistributionTelemetrySurface;
  readonly eventType: CommunityDistributionTelemetryEventType;
}

export interface NormalizedCommunityDistributionTelemetryRequest {
  readonly events: readonly CommunityDistributionTelemetryEvent[];
}

const SAFE_COMMUNITY_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SURFACES = new Set<CommunityDistributionTelemetrySurface>([
  'social_explore_recommendation',
  'social_explore_activity',
  'social_explore_content',
]);
const EVENT_TYPES = new Set<CommunityDistributionTelemetryEventType>([
  'qualified_exposure',
  'open',
]);

function normalizeSurface(
  value: unknown
): CommunityDistributionTelemetrySurface | null {
  return typeof value === 'string'
    && SURFACES.has(value as CommunityDistributionTelemetrySurface)
    ? value as CommunityDistributionTelemetrySurface
    : null;
}

function normalizeEventType(
  value: unknown
): CommunityDistributionTelemetryEventType | null {
  return typeof value === 'string'
    && EVENT_TYPES.has(value as CommunityDistributionTelemetryEventType)
    ? value as CommunityDistributionTelemetryEventType
    : null;
}

export function normalizeCommunityDistributionTelemetryRequest(
  raw: CommunityDistributionTelemetryRequest | null | undefined
): NormalizedCommunityDistributionTelemetryRequest | null {
  if (
    !Array.isArray(raw?.events)
    || raw.events.length < 1
    || raw.events.length > COMMUNITY_DISTRIBUTION_TELEMETRY_BATCH_SIZE
  ) {
    return null;
  }

  const events: CommunityDistributionTelemetryEvent[] = [];
  const seen = new Set<string>();

  for (const rawEvent of raw.events) {
    const source = rawEvent && typeof rawEvent === 'object'
      && !Array.isArray(rawEvent)
      ? rawEvent as Record<string, unknown>
      : null;
    if (!source) return null;

    const communityId = String(source['communityId'] ?? '').trim();
    const surface = normalizeSurface(source['surface']);
    const eventType = normalizeEventType(source['eventType']);

    if (!SAFE_COMMUNITY_ID_PATTERN.test(communityId) || !surface || !eventType) {
      return null;
    }

    const key = `${communityId}:${surface}:${eventType}`;
    if (seen.has(key)) continue;

    seen.add(key);
    events.push({ communityId, surface, eventType });
  }

  return events.length > 0 ? { events } : null;
}
