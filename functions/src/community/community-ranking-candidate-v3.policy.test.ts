// functions/src/community/community-ranking-candidate-v3.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_ACTIVITY_CONFIDENCE_MODEL_VERSION,
  COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
  buildCommunityDiscoveryRankingCandidateV3,
} from './community-ranking-candidate-v3.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);

function community(
  metrics: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) {
  return {
    description: [
      'Comunidade com descrição útil, objetiva e suficientemente completa',
      'para orientar novos participantes.',
    ].join(' '),
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderation: { state: 'active' },
    metrics,
    lifecycle: { lastMeaningfulActivityAt: NOW },
    createdAt: NOW - 120 * DAY_MS,
    updatedAt: NOW,
    ...overrides,
  };
}

const visualDiscovery = {
  avatarUrl: 'https://cdn.example.com/avatar.webp',
  coverUrl: 'https://cdn.example.com/cover.webp',
};

test('bootstrap v3 cria baseline sem transformar volume histórico em atividade recente', () => {
  const candidate = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 200,
      postCount: 20_000,
      mediaCount: 5_000,
      interactionCount: 80_000,
    }),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });

  assert.equal(
    candidate.scoreVersion,
    COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION
  );
  assert.deepEqual(candidate.activityDelta, {
    memberGrowth: 0,
    memberLoss: 0,
    postGrowth: 0,
    mediaGrowth: 0,
    interactionGrowth: 0,
  });
  assert.deepEqual(candidate.activityMomentum, {
    shortTerm: 0,
    mediumTerm: 0,
    churnShortTerm: 0,
    churnMediumTerm: 0,
  });
  assert.deepEqual(candidate.activityConfidence, {
    modelVersion: COMMUNITY_ACTIVITY_CONFIDENCE_MODEL_VERSION,
    effectiveEvidence: 0,
    confidence: 0,
  });
  assert.equal(candidate.activityScore <= 15, true);
});

test('crescimento entre medições aumenta momento e atividade', () => {
  const first = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 20,
      postCount: 30,
      mediaCount: 4,
      interactionCount: 10,
    }),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });
  const second = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 23,
      postCount: 35,
      mediaCount: 6,
      interactionCount: 18,
    }),
    rawDiscovery: {
      ...visualDiscovery,
      rankingCandidate: first,
    },
    now: NOW + DAY_MS,
  });

  assert.deepEqual(second.activityDelta, {
    memberGrowth: 3,
    memberLoss: 0,
    postGrowth: 5,
    mediaGrowth: 2,
    interactionGrowth: 8,
  });
  assert.equal(second.activityMomentum.shortTerm > 0, true);
  assert.equal(second.activityMomentum.mediumTerm > 0, true);
  assert.equal(second.activityConfidence.confidence > 0, true);
  assert.equal(second.activityScore > first.activityScore, true);
});

test('amostra mínima recebe confiança baixa em vez de bônus cheio', () => {
  const baseline = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 2,
      postCount: 1,
      mediaCount: 0,
      interactionCount: 0,
    }),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });
  const singleInteraction = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 2,
      postCount: 1,
      mediaCount: 0,
      interactionCount: 1,
    }),
    rawDiscovery: { ...visualDiscovery, rankingCandidate: baseline },
    now: NOW + DAY_MS,
  });

  assert.equal(singleInteraction.activityDelta.interactionGrowth, 1);
  assert.equal(singleInteraction.activityConfidence.effectiveEvidence > 0, true);
  assert.equal(singleInteraction.activityConfidence.confidence < 0.10, true);
  assert.equal(singleInteraction.activityScore <= 10, true);
});

test('evidência sustentada aumenta confiança e supera pico isolado', () => {
  const baseline = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 4,
      postCount: 2,
      mediaCount: 0,
      interactionCount: 1,
    }),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });
  const isolated = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 4,
      postCount: 2,
      mediaCount: 0,
      interactionCount: 2,
    }),
    rawDiscovery: { ...visualDiscovery, rankingCandidate: baseline },
    now: NOW + DAY_MS,
  });
  const supported = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 5,
      postCount: 4,
      mediaCount: 1,
      interactionCount: 12,
    }),
    rawDiscovery: { ...visualDiscovery, rankingCandidate: baseline },
    now: NOW + DAY_MS,
  });

  assert.equal(
    supported.activityConfidence.effectiveEvidence
      > isolated.activityConfidence.effectiveEvidence,
    true
  );
  assert.equal(
    supported.activityConfidence.confidence
      > isolated.activityConfidence.confidence,
    true
  );
  assert.equal(supported.activityScore > isolated.activityScore, true);
});

test('interação real alimenta o candidato mesmo sem nova publicação', () => {
  const first = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 20,
      postCount: 30,
      mediaCount: 4,
      interactionCount: 10,
    }),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });
  const interacted = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 20,
      postCount: 30,
      mediaCount: 4,
      interactionCount: 25,
    }),
    rawDiscovery: { ...visualDiscovery, rankingCandidate: first },
    now: NOW + DAY_MS,
  });

  assert.equal(interacted.activityDelta.interactionGrowth, 15);
  assert.equal(interacted.activityDelta.postGrowth, 0);
  assert.equal(interacted.activityConfidence.confidence > 0, true);
  assert.equal(interacted.activityScore > first.activityScore, true);
});

test('momento e confiança decaem sem novas métricas', () => {
  const first = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 20,
      postCount: 30,
      mediaCount: 4,
      interactionCount: 10,
    }),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });
  const active = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 22,
      postCount: 40,
      mediaCount: 8,
      interactionCount: 30,
    }),
    rawDiscovery: { ...visualDiscovery, rankingCandidate: first },
    now: NOW + DAY_MS,
  });
  const decayed = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community(
      {
        memberCount: 22,
        postCount: 40,
        mediaCount: 8,
        interactionCount: 30,
      },
      {
        lifecycle: {
          lastMeaningfulActivityAt: NOW + DAY_MS,
        },
        updatedAt: NOW + DAY_MS,
      }
    ),
    rawDiscovery: { ...visualDiscovery, rankingCandidate: active },
    now: NOW + 31 * DAY_MS,
  });

  assert.equal(
    decayed.activityMomentum.shortTerm < active.activityMomentum.shortTerm,
    true
  );
  assert.equal(
    decayed.activityMomentum.mediumTerm < active.activityMomentum.mediumTerm,
    true
  );
  assert.equal(
    decayed.activityConfidence.confidence < active.activityConfidence.confidence,
    true
  );
  assert.equal(decayed.activityScore < active.activityScore, true);
});

test('perda de membros gera churn sem ser mascarada por baixa confiança positiva', () => {
  const first = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 100,
      postCount: 40,
      mediaCount: 5,
      interactionCount: 20,
    }),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });
  const churned = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 80,
      postCount: 40,
      mediaCount: 5,
      interactionCount: 20,
    }),
    rawDiscovery: { ...visualDiscovery, rankingCandidate: first },
    now: NOW + DAY_MS,
  });

  assert.equal(churned.activityDelta.memberLoss, 20);
  assert.equal(churned.activityDelta.memberGrowth, 0);
  assert.equal(churned.activityMomentum.churnShortTerm > 0, true);
  assert.equal(churned.activityMomentum.churnMediumTerm > 0, true);
  assert.equal(churned.activityConfidence.confidence, 0);
  assert.equal(churned.activityScore < first.activityScore, true);
});

test('comunidade menor e realmente ativa pode superar comunidade grande estagnada', () => {
  const smallBaseline = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 10,
      postCount: 10,
      mediaCount: 1,
      interactionCount: 4,
    }),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });
  const smallActive = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community({
      memberCount: 14,
      postCount: 22,
      mediaCount: 5,
      interactionCount: 30,
    }),
    rawDiscovery: { ...visualDiscovery, rankingCandidate: smallBaseline },
    now: NOW + DAY_MS,
  });
  const largeStagnant = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community(
      {
        memberCount: 500,
        postCount: 20_000,
        mediaCount: 3_000,
        interactionCount: 100_000,
      },
      {
        lifecycle: { lastMeaningfulActivityAt: NOW - 180 * DAY_MS },
        updatedAt: NOW - 180 * DAY_MS,
      }
    ),
    rawDiscovery: visualDiscovery,
    now: NOW + DAY_MS,
  });

  assert.equal(smallActive.activityConfidence.confidence > 0.80, true);
  assert.equal(smallActive.activityScore > largeStagnant.activityScore, true);
  assert.equal(smallActive.discoveryScore > largeStagnant.discoveryScore, true);
});

test('segurança continua gate absoluto no candidato v3', () => {
  const candidate = buildCommunityDiscoveryRankingCandidateV3({
    rawCommunity: community(
      {
        memberCount: 30,
        postCount: 60,
        mediaCount: 8,
        interactionCount: 20,
      },
      { moderation: { state: 'restricted' } }
    ),
    rawDiscovery: visualDiscovery,
    now: NOW,
  });

  assert.equal(candidate.safetyScore, 0);
  assert.equal(candidate.discoveryScore, 0);
});
