// functions/src/community/community-ranking-sync.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING SYNC POLICY
// -----------------------------------------------------------------------------
// Converte a política canônica de ranking em patch persistível da projeção de
// descoberta, evita writes quando o score material não mudou e impede que um
// cursor de backfill de versão anterior seja reutilizado pela versão atual.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_DISCOVERY_SCORE_VERSION,
  buildCommunityDiscoveryRanking,
  type CommunityDiscoveryRankingBreakdown,
} from './community-ranking.policy';

export interface CommunityRankingProjectionPatch {
  discoveryScore: number;
  ranking: CommunityDiscoveryRankingBreakdown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));

  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function sameScore(value: unknown, expected: number): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.round(parsed) === expected;
}

export function isCommunityRankingSupportedDocument(
  rawCommunity: unknown
): boolean {
  const community = asRecord(rawCommunity);
  const source = asRecord(community['source']);

  return source['type'] === 'community' || source['type'] === 'venue';
}

export function buildCommunityRankingProjectionPatch(
  rawCommunity: unknown,
  rawDiscovery: unknown,
  now: number
): CommunityRankingProjectionPatch {
  const ranking = buildCommunityDiscoveryRanking({
    rawCommunity,
    rawDiscovery,
    now,
  });

  return {
    discoveryScore: ranking.discoveryScore,
    ranking,
  };
}

export function isCommunityRankingProjectionCurrent(
  rawDiscovery: unknown,
  expected: Readonly<CommunityRankingProjectionPatch>
): boolean {
  const discovery = asRecord(rawDiscovery);
  const ranking = asRecord(discovery['ranking']);
  const target = expected.ranking;

  return sameScore(discovery['discoveryScore'], expected.discoveryScore)
    && sameScore(ranking['discoveryScore'], target.discoveryScore)
    && sameScore(ranking['qualityScore'], target.qualityScore)
    && sameScore(ranking['activityScore'], target.activityScore)
    && sameScore(ranking['freshnessScore'], target.freshnessScore)
    && sameScore(ranking['safetyScore'], target.safetyScore)
    && Number(ranking['scoreVersion']) === target.scoreVersion;
}

export function haveCommunityRankingVisualInputsChanged(
  beforeRaw: unknown,
  afterRaw: unknown
): boolean {
  const before = asRecord(beforeRaw);
  const after = asRecord(afterRaw);

  if (!beforeRaw && afterRaw) return true;
  if (beforeRaw && !afterRaw) return true;

  return normalizeText(before['description']) !== normalizeText(after['description'])
    || normalizeText(before['avatarUrl']) !== normalizeText(after['avatarUrl'])
    || normalizeText(before['coverUrl']) !== normalizeText(after['coverUrl']);
}

export function isCommunityRankingRuntimeCurrent(rawRuntime: unknown): boolean {
  const runtime = asRecord(rawRuntime);
  return Number(runtime['scoreVersion']) === COMMUNITY_DISCOVERY_SCORE_VERSION;
}

export function resolveCommunityRankingMaxPerRun(rawConfig: unknown): number {
  const config = asRecord(rawConfig);

  return normalizeInteger(
    config['rankingMaxCommunitiesPerRun'],
    1_000,
    100,
    10_000
  );
}
