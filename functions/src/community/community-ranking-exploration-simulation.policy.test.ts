// functions/src/community/community-ranking-exploration-simulation.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_EXPLORATION_TOP_K,
  buildCommunityRankingExplorationSimulation,
} from './community-ranking-exploration-simulation.policy';

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1_000;

function entry(index: number, overrides: Record<string, unknown> = {}) {
  return {
    communityId: `community-${index}`,
    discoveryScore: Math.max(30, 90 - index * 0.5),
    qualityScore: 60,
    freshnessScore: 90,
    safetyScore: 100,
    communityCreatedAt: NOW - 90 * DAY_MS,
    ...overrides,
  };
}

test('preenche no máximo duas oportunidades quando top-K não tem cold-start', () => {
  const candidateScan = Array.from({ length: 40 }, (_, index) => entry(index));
  candidateScan[25] = entry(25, { communityCreatedAt: NOW - 2 * DAY_MS });
  candidateScan[26] = entry(26, { communityCreatedAt: NOW - 5 * DAY_MS });
  candidateScan[27] = entry(27, { communityCreatedAt: NOW - DAY_MS });

  const simulation = buildCommunityRankingExplorationSimulation({
    candidateScan,
    now: NOW,
  });

  assert.equal(simulation.topK, COMMUNITY_EXPLORATION_TOP_K);
  assert.equal(simulation.baselineNewCount, 0);
  assert.equal(simulation.eligiblePoolCount, 3);
  assert.equal(simulation.selectedExplorationCount, 2);
  assert.equal(simulation.simulatedNewCount, 2);
  assert.equal(simulation.simulatedNewShare, 8);
});

test('não cria slots adicionais quando top-K já contém duas comunidades novas', () => {
  const candidateScan = Array.from({ length: 35 }, (_, index) => entry(index));
  candidateScan[2] = entry(2, { communityCreatedAt: NOW - 3 * DAY_MS });
  candidateScan[8] = entry(8, { communityCreatedAt: NOW - 7 * DAY_MS });
  candidateScan[25] = entry(25, { communityCreatedAt: NOW - DAY_MS });

  const simulation = buildCommunityRankingExplorationSimulation({
    candidateScan,
    now: NOW,
  });

  assert.equal(simulation.baselineNewCount, 2);
  assert.equal(simulation.selectedExplorationCount, 0);
  assert.equal(simulation.simulatedNewCount, 2);
});

test('rejeita cold-start inseguro ou sem qualidade mínima', () => {
  const candidateScan = Array.from({ length: 30 }, (_, index) => entry(index));
  candidateScan[25] = entry(25, {
    communityCreatedAt: NOW - DAY_MS,
    safetyScore: 0,
  });
  candidateScan[26] = entry(26, {
    communityCreatedAt: NOW - DAY_MS,
    qualityScore: 20,
  });
  candidateScan[27] = entry(27, {
    communityCreatedAt: NOW - DAY_MS,
    freshnessScore: 50,
  });

  const simulation = buildCommunityRankingExplorationSimulation({
    candidateScan,
    now: NOW,
  });

  assert.equal(simulation.eligiblePoolCount, 0);
  assert.equal(simulation.selectedExplorationCount, 0);
});

test('diagnóstico não devolve identificadores das comunidades simuladas', () => {
  const candidateScan = Array.from({ length: 30 }, (_, index) => entry(index));
  candidateScan[25] = entry(25, { communityCreatedAt: NOW - DAY_MS });

  const serialized = JSON.stringify(
    buildCommunityRankingExplorationSimulation({ candidateScan, now: NOW })
  );

  assert.equal(serialized.includes('communityId'), false);
  assert.equal(serialized.includes('community-25'), false);
});
