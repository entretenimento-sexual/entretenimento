// functions/src/community/community-ranking-rollout.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_DISCOVERY_RANKING_MODE,
  COMMUNITY_DISCOVERY_SCORE_VERSION,
} from './community-ranking.policy';
import { evaluateCommunityRankingRollout } from './community-ranking-rollout.policy';

test('rollback legado permanece sempre disponível', () => {
  const decision = evaluateCommunityRankingRollout({
    action: 'rollback_legacy',
    rawConfig: null,
    rawRuntime: null,
  });

  assert.deepEqual(decision, {
    allowed: true,
    action: 'rollback_legacy',
    targetMode: 'legacy',
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    denialReason: null,
  });
});

test('não ativa score enquanto o índice não estiver homologado', () => {
  const decision = evaluateCommunityRankingRollout({
    action: 'enable_current',
    rawConfig: {},
    rawRuntime: {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'score_index_not_ready');
});

test('não ativa score antes de um ciclo completo de backfill', () => {
  const decision = evaluateCommunityRankingRollout({
    action: 'enable_current',
    rawConfig: { discoveryScoreIndexReady: true },
    rawRuntime: { ready: false },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'score_backfill_not_ready');
});

test('não ativa runtime de versão antiga', () => {
  const decision = evaluateCommunityRankingRollout({
    action: 'enable_current',
    rawConfig: { discoveryScoreIndexReady: true },
    rawRuntime: {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION - 1,
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'score_version_mismatch');
});

test('ativa somente a versão canônica atual após todos os gates', () => {
  const decision = evaluateCommunityRankingRollout({
    action: 'enable_current',
    rawConfig: { discoveryScoreIndexReady: true },
    rawRuntime: {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    },
  });

  assert.deepEqual(decision, {
    allowed: true,
    action: 'enable_current',
    targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    denialReason: null,
  });
});
