// functions/src/community/community-discovery-ranking-mode.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMUNITY_DISCOVERY_SCORE_VERSION } from './community-ranking.policy';
import { resolveCommunityDiscoveryRankingMode } from './community-discovery-ranking-mode.policy';

test('mantém ranking legado por padrão', () => {
  const decision = resolveCommunityDiscoveryRankingMode({}, {});

  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.orderField, 'rankScore');
  assert.equal(decision.fallbackReason, 'score_not_requested');
});

test('não ativa score sem índice explicitamente pronto', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    { discoveryRankingMode: 'score_v1' },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    }
  );

  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.fallbackReason, 'score_index_not_ready');
});

test('não ativa score sem ciclo completo de backfill', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: 'score_v1',
      discoveryScoreIndexReady: true,
    },
    { ready: false }
  );

  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.fallbackReason, 'score_backfill_not_ready');
});

test('não ativa score de versão diferente da política atual', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: 'score_v1',
      discoveryScoreIndexReady: true,
    },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION + 1,
    }
  );

  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.fallbackReason, 'score_version_mismatch');
});

test('ativa score somente quando todos os gates estão prontos', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: 'score_v1',
      discoveryScoreIndexReady: true,
    },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    }
  );

  assert.equal(decision.effectiveMode, 'score_v1');
  assert.equal(decision.orderField, 'discoveryScore');
  assert.equal(decision.fallbackReason, null);
});
