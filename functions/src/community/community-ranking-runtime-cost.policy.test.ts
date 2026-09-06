import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
} from './community-ranking-candidate-v3.policy';
import { COMMUNITY_DISCOVERY_SCORE_VERSION } from './community-ranking.policy';
import {
  haveCommunityRankingCommunityInputsChanged,
  isCommunityRankingCandidateRuntimeCurrent,
} from './community-ranking-sync.policy';

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);

function community(overrides: Record<string, unknown> = {}) {
  return {
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderation: { state: 'active' },
    description: 'Descrição estável da Comunidade.',
    metrics: {
      memberCount: 20,
      postCount: 30,
      mediaCount: 4,
      interactionCount: 10,
    },
    lifecycle: { lastMeaningfulActivityAt: NOW },
    createdAt: NOW - 30 * 24 * 60 * 60 * 1_000,
    updatedAt: NOW,
    ...overrides,
  };
}

test('ignora escrita sem efeito no ranking quando há frescor canônico', () => {
  const before = community({
    ownerUid: 'owner-1',
    settings: { invitePolicy: 'members' },
  });
  const after = community({
    ownerUid: 'owner-2',
    settings: { invitePolicy: 'moderators' },
    updatedAt: NOW + 60_000,
  });

  assert.equal(
    haveCommunityRankingCommunityInputsChanged(before, after),
    false
  );
});

test('mantém updatedAt relevante somente quando ele é fallback de frescor', () => {
  const before = community({
    lifecycle: {},
    updatedAt: NOW,
  });
  const after = community({
    lifecycle: {},
    updatedAt: NOW + 60_000,
  });

  assert.equal(
    haveCommunityRankingCommunityInputsChanged(before, after),
    true
  );
});

test('detecta métricas, frescor, segurança e criação que alimentam o ranking', () => {
  const base = community();

  assert.equal(
    haveCommunityRankingCommunityInputsChanged(
      base,
      community({
        metrics: {
          memberCount: 20,
          postCount: 30,
          mediaCount: 4,
          interactionCount: 11,
        },
      })
    ),
    true
  );
  assert.equal(
    haveCommunityRankingCommunityInputsChanged(
      base,
      community({ lifecycle: { lastMeaningfulActivityAt: NOW + 1 } })
    ),
    true
  );
  assert.equal(
    haveCommunityRankingCommunityInputsChanged(
      base,
      community({ moderation: { state: 'restricted' } })
    ),
    true
  );
  assert.equal(
    haveCommunityRankingCommunityInputsChanged(
      base,
      community({ createdAt: NOW - 31 * 24 * 60 * 60 * 1_000 })
    ),
    true
  );
});

test('runtime do candidato exige o modelo de momentum atual', () => {
  const current = {
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    candidateActivityMomentumModelVersion:
      COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
  };

  assert.equal(isCommunityRankingCandidateRuntimeCurrent(current), true);
  assert.equal(
    isCommunityRankingCandidateRuntimeCurrent({
      ...current,
      candidateActivityMomentumModelVersion:
        COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION - 1,
    }),
    false
  );
  assert.equal(
    isCommunityRankingCandidateRuntimeCurrent({
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    }),
    false
  );
});
