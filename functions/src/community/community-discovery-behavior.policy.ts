// functions/src/community/community-discovery-behavior.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY BEHAVIOR POLICY
// -----------------------------------------------------------------------------
// Agregado privado e limitado. Não é analytics bruto e não infere preferências
// sensíveis entre comunidades. O ranking orgânico continua autoritativo.
// -----------------------------------------------------------------------------

export const COMMUNITY_DISCOVERY_BEHAVIOR_SCHEMA_VERSION = 1;
export const COMMUNITY_DISCOVERY_OPEN_DEDUP_MS = 6 * 60 * 60 * 1_000;
export const COMMUNITY_DISCOVERY_MAX_MEANINGFUL_OPENS = 20;
export const COMMUNITY_DISCOVERY_BEHAVIOR_CONTEXT_LIMIT = 80;

export type CommunityDiscoveryBehaviorCommand =
  | 'meaningful_open'
  | 'not_interested'
  | 'restore_interest';

export interface CommunityDiscoveryBehaviorAggregate {
  readonly schemaVersion: 1;
  readonly communityId: string;
  readonly meaningfulOpenCount: number;
  readonly lastMeaningfulOpenAtMs: number | null;
  readonly memberActive: boolean;
  readonly lastJoinedAtMs: number | null;
  readonly lastLeftAtMs: number | null;
  readonly lastMembershipTransitionAtMs: number | null;
  readonly notInterested: boolean;
  readonly notInterestedAtMs: number | null;
  readonly updatedAtMs: number;
}

function normalizeEpochMs(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), COMMUNITY_DISCOVERY_MAX_MEANINGFUL_OPENS)
    : 0;
}

export function normalizeCommunityDiscoveryBehaviorAggregate(
  communityId: string,
  raw: unknown,
  now = Date.now()
): CommunityDiscoveryBehaviorAggregate {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};

  return {
    schemaVersion: COMMUNITY_DISCOVERY_BEHAVIOR_SCHEMA_VERSION,
    communityId,
    meaningfulOpenCount: normalizeCount(source['meaningfulOpenCount']),
    lastMeaningfulOpenAtMs: normalizeEpochMs(source['lastMeaningfulOpenAtMs']),
    memberActive: source['memberActive'] === true,
    lastJoinedAtMs: normalizeEpochMs(source['lastJoinedAtMs']),
    lastLeftAtMs: normalizeEpochMs(source['lastLeftAtMs']),
    lastMembershipTransitionAtMs: normalizeEpochMs(
      source['lastMembershipTransitionAtMs']
    ),
    notInterested: source['notInterested'] === true,
    notInterestedAtMs: normalizeEpochMs(source['notInterestedAtMs']),
    updatedAtMs: normalizeEpochMs(source['updatedAtMs']) ?? now,
  };
}

export function shouldRecordMeaningfulCommunityOpen(
  aggregate: Readonly<CommunityDiscoveryBehaviorAggregate>,
  now = Date.now()
): boolean {
  const previous = aggregate.lastMeaningfulOpenAtMs;
  return previous === null || now - previous >= COMMUNITY_DISCOVERY_OPEN_DEDUP_MS;
}

export function nextMeaningfulCommunityOpenAggregate(
  aggregate: Readonly<CommunityDiscoveryBehaviorAggregate>,
  now = Date.now()
): CommunityDiscoveryBehaviorAggregate {
  return {
    ...aggregate,
    meaningfulOpenCount: Math.min(
      aggregate.meaningfulOpenCount + 1,
      COMMUNITY_DISCOVERY_MAX_MEANINGFUL_OPENS
    ),
    lastMeaningfulOpenAtMs: now,
    updatedAtMs: now,
  };
}

export function nextCommunityInterestVisibilityAggregate(
  aggregate: Readonly<CommunityDiscoveryBehaviorAggregate>,
  notInterested: boolean,
  now = Date.now()
): CommunityDiscoveryBehaviorAggregate {
  return {
    ...aggregate,
    notInterested,
    notInterestedAtMs: notInterested ? now : null,
    updatedAtMs: now,
  };
}

export function nextCommunityMembershipBehaviorAggregate(
  aggregate: Readonly<CommunityDiscoveryBehaviorAggregate>,
  active: boolean,
  transitionAtMs: number
): CommunityDiscoveryBehaviorAggregate {
  if (
    aggregate.lastMembershipTransitionAtMs !== null
    && aggregate.lastMembershipTransitionAtMs >= transitionAtMs
  ) {
    return aggregate;
  }

  return {
    ...aggregate,
    memberActive: active,
    lastJoinedAtMs: active ? transitionAtMs : aggregate.lastJoinedAtMs,
    lastLeftAtMs: active ? aggregate.lastLeftAtMs : transitionAtMs,
    lastMembershipTransitionAtMs: transitionAtMs,
    updatedAtMs: Math.max(aggregate.updatedAtMs, transitionAtMs),
  };
}
