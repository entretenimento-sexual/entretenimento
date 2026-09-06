import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
  buildCommunityDiscoveryRankingCandidateV3,
} from './community-ranking-candidate-v3.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);

function community() {
  return {
    description: 'Comunidade com descrição suficiente para o ranking shadow.',
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderation: { state: 'active' },
    metrics: {
      memberCount: 100,
      postCount: 40,
      mediaCount: 5,
      interactionCount: 20,
    },
    lifecycle: { lastMeaningfulActivityAt: NOW },
    createdAt: NOW - 120 * DAY_MS,
    updatedAt: NOW,
  };
}

test('modelo de momentum anterior não contamina o baseline shadow atual', () => {
  const current = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community(),
    rawDiscovery: {},
    now: NOW,
  });
  const legacyCandidate = {
    ...current,
    activityMomentumModelVersion:
      COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION - 1,
    activityMomentum: {
      shortTerm: 80,
      mediumTerm: 120,
      churnShortTerm: 0,
      churnMediumTerm: 0,
    },
    activityConfidence: {
      modelVersion: 1,
      effectiveEvidence: 100,
      confidence: 0.9,
    },
  };
  const migrated = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community(),
    rawDiscovery: { rankingCandidate: legacyCandidate },
    now: NOW + DAY_MS,
  });

  assert.equal(
    migrated.activityMomentumModelVersion,
    COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION
  );
  assert.deepEqual(migrated.activityMomentum, {
    shortTerm: 0,
    mediumTerm: 0,
    churnShortTerm: 0,
    churnMediumTerm: 0,
  });
  assert.deepEqual(migrated.activityDelta, {
    memberGrowth: 0,
    memberLoss: 0,
    postGrowth: 0,
    mediaGrowth: 0,
    interactionGrowth: 0,
  });
  assert.equal(migrated.activityConfidence.effectiveEvidence, 0);
  assert.equal(migrated.activityConfidence.confidence, 0);
});
