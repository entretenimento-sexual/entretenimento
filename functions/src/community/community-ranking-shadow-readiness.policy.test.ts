import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
} from './community-ranking-candidate-v3.policy';
import {
  resolveCommunityRankingShadowReadiness,
} from './community-ranking-shadow-readiness.policy';

test('fecha o diagnóstico shadow quando o ciclo autoritativo não está pronto', () => {
  assert.deepEqual(
    resolveCommunityRankingShadowReadiness({
      runtimeReadyForTarget: false,
      completedCandidateActivityMomentumModelVersion:
        COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
    }),
    {
      available: false,
      unavailableReason: 'ranking_cycle_not_ready',
    }
  );
});

test('fecha o diagnóstico shadow durante a migração do momentum', () => {
  for (const completedVersion of [
    undefined,
    null,
    COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION - 1,
  ]) {
    assert.deepEqual(
      resolveCommunityRankingShadowReadiness({
        runtimeReadyForTarget: true,
        completedCandidateActivityMomentumModelVersion: completedVersion,
      }),
      {
        available: false,
        unavailableReason: 'candidate_activity_momentum_migration_in_progress',
      }
    );
  }
});

test('libera o diagnóstico shadow somente após o momentum atual ser concluído', () => {
  assert.deepEqual(
    resolveCommunityRankingShadowReadiness({
      runtimeReadyForTarget: true,
      completedCandidateActivityMomentumModelVersion:
        COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
    }),
    {
      available: true,
      unavailableReason: null,
    }
  );
});
