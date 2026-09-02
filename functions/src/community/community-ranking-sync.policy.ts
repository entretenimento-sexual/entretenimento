// functions/src/community/community-ranking-sync.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING SYNC POLICY
// -----------------------------------------------------------------------------
// Converte a política canônica de ranking em patch persistível da projeção de
// descoberta, evita writes quando o score material não mudou e impede que um
// cursor de backfill de versão anterior seja reutilizado pela versão atual.
// O candidato v3 é shadow-only e nunca substitui discoveryScore nesta fase.
// -----------------------------------------------------------------------------

import {
  buildCommunityDiscoveryRankingCandidateV3,
  type CommunityDiscoveryRankingCandidateV3,
} from './community-ranking-candidate-v3.policy';
import {
  COMMUNITY_DISCOVERY_SCORE_VERSION,
  buildCommunityDiscoveryRanking,
  type CommunityDiscoveryRankingBreakdown,
} from './community-ranking.policy';

export interface CommunityRankingProjectionPatch {
  discoveryScore: number;
  ranking: CommunityDiscoveryRankingBreakdown;
  rankingCandidate: CommunityDiscoveryRankingCandidateV3;
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

function sameMomentum(value: unknown, expected: number): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    && Math.abs(parsed - expected) < 0.0001;
}

function sameCount(value: unknown, expected: number): boolean {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed === expected;
}

function isCandidateV3Current(
  rawCandidate: unknown,
  expected: Readonly<CommunityDiscoveryRankingCandidateV3>
): boolean {
  const candidate = asRecord(rawCandidate);
  const baseline = asRecord(candidate['activityBaseline']);
  const momentum = asRecord(candidate['activityMomentum']);

  return sameScore(candidate['discoveryScore'], expected.discoveryScore)
    && sameScore(candidate['qualityScore'], expected.qualityScore)
    && sameScore(candidate['activityScore'], expected.activityScore)
    && sameScore(candidate['freshnessScore'], expected.freshnessScore)
    && sameScore(candidate['safetyScore'], expected.safetyScore)
    && Number(candidate['scoreVersion']) === expected.scoreVersion
    && sameCount(
      baseline['memberCount'],
      expected.activityBaseline.memberCount
    )
    && sameCount(
      baseline['postCount'],
      expected.activityBaseline.postCount
    )
    && sameCount(
      baseline['mediaCount'],
      expected.activityBaseline.mediaCount
    )
    && sameCount(
      baseline['interactionCount'],
      expected.activityBaseline.interactionCount
    )
    && sameMomentum(
      momentum['shortTerm'],
      expected.activityMomentum.shortTerm
    )
    && sameMomentum(
      momentum['mediumTerm'],
      expected.activityMomentum.mediumTerm
    )
    && sameMomentum(
      momentum['churnShortTerm'],
      expected.activityMomentum.churnShortTerm
    )
    && sameMomentum(
      momentum['churnMediumTerm'],
      expected.activityMomentum.churnMediumTerm
    );
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
  const rankingCandidate = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity,
    rawDiscovery,
    now,
  });

  return {
    discoveryScore: ranking.discoveryScore,
    ranking,
    rankingCandidate,
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
    && Number(ranking['scoreVersion']) === target.scoreVersion
    && isCandidateV3Current(
      discovery['rankingCandidate'],
      expected.rankingCandidate
    );
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
