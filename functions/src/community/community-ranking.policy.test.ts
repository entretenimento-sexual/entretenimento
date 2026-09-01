// functions/src/community/community-ranking.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_DISCOVERY_RANKING_MODE,
  COMMUNITY_DISCOVERY_SCORE_VERSION,
  buildCommunityDiscoveryRanking,
} from './community-ranking.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

function community(overrides: Record<string, unknown> = {}) {
  return {
    description: [
      'Comunidade com descrição útil, objetiva e suficientemente completa',
      'para orientar novos participantes.',
    ].join(' '),
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderation: { state: 'active' },
    metrics: { memberCount: 12, postCount: 24, mediaCount: 4 },
    lifecycle: { lastMeaningfulActivityAt: NOW - DAY_MS },
    createdAt: NOW - 60 * DAY_MS,
    updatedAt: NOW - DAY_MS,
    ...overrides,
  };
}

test('gera score v2 versionado e limitado entre zero e cem', () => {
  const ranking = buildCommunityDiscoveryRanking({
    rawCommunity: community({
      metrics: {
        memberCount: 1_000_000_000,
        postCount: 1_000_000_000,
        mediaCount: 1_000_000_000,
      },
    }),
    rawDiscovery: {
      avatarUrl: 'https://cdn.example.com/avatar.webp',
      coverUrl: 'https://cdn.example.com/cover.webp',
    },
    now: NOW,
  });

  assert.equal(COMMUNITY_DISCOVERY_SCORE_VERSION, 2);
  assert.equal(COMMUNITY_DISCOVERY_RANKING_MODE, 'score_v2');
  assert.equal(ranking.scoreVersion, COMMUNITY_DISCOVERY_SCORE_VERSION);
  assert.equal(ranking.scoreUpdatedAt, NOW);

  for (const score of [
    ranking.discoveryScore,
    ranking.qualityScore,
    ranking.activityScore,
    ranking.freshnessScore,
    ranking.safetyScore,
  ]) {
    assert.equal(Number.isInteger(score), true);
    assert.equal(score >= 0 && score <= 100, true);
  }
});

test('atividade saudável e recente supera comunidade vazia e antiga', () => {
  const healthy = buildCommunityDiscoveryRanking({
    rawCommunity: community(),
    rawDiscovery: {
      avatarUrl: 'https://cdn.example.com/avatar.webp',
      coverUrl: 'https://cdn.example.com/cover.webp',
    },
    now: NOW,
  });
  const stale = buildCommunityDiscoveryRanking({
    rawCommunity: community({
      description: '',
      metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
      lifecycle: { lastMeaningfulActivityAt: NOW - 240 * DAY_MS },
    }),
    now: NOW,
  });

  assert.equal(healthy.discoveryScore > stale.discoveryScore, true);
  assert.equal(healthy.activityScore > stale.activityScore, true);
  assert.equal(healthy.freshnessScore > stale.freshnessScore, true);
});

test('volume bruto satura e não consegue ultrapassar cem', () => {
  const ranking = buildCommunityDiscoveryRanking({
    rawCommunity: community({
      metrics: {
        memberCount: 2,
        postCount: Number.MAX_SAFE_INTEGER,
        mediaCount: Number.MAX_SAFE_INTEGER,
      },
    }),
    now: NOW,
  });

  assert.equal(ranking.activityScore <= 100, true);
  assert.equal(ranking.discoveryScore <= 100, true);
});

test('segurança e lifecycle são gate e não bônus constante do ranking', () => {
  const active = buildCommunityDiscoveryRanking({
    rawCommunity: community(),
    now: NOW,
  });
  const moderated = buildCommunityDiscoveryRanking({
    rawCommunity: community({ moderation: { state: 'restricted' } }),
    now: NOW,
  });
  const paused = buildCommunityDiscoveryRanking({
    rawCommunity: community({ status: 'paused' }),
    now: NOW,
  });
  const expectedEligibleScore = Math.round(
    active.qualityScore * 0.25
      + active.activityScore * 0.45
      + active.freshnessScore * 0.30
  );

  assert.equal(active.safetyScore, 100);
  assert.equal(active.discoveryScore, expectedEligibleScore);
  assert.equal(moderated.safetyScore, 0);
  assert.equal(moderated.discoveryScore, 0);
  assert.equal(paused.safetyScore, 0);
  assert.equal(paused.discoveryScore, 0);
});

test('aceita timestamp compatível com Firestore sem depender do SDK', () => {
  const ranking = buildCommunityDiscoveryRanking({
    rawCommunity: community({
      lifecycle: {
        lastMeaningfulActivityAt: {
          seconds: Math.trunc((NOW - 7 * DAY_MS) / 1_000),
          nanoseconds: 0,
        },
      },
    }),
    now: NOW,
  });

  assert.equal(ranking.freshnessScore, 90);
});

test('mesmas entradas produzem o mesmo breakdown', () => {
  const first = buildCommunityDiscoveryRanking({
    rawCommunity: community(),
    rawDiscovery: { avatarUrl: 'https://cdn.example.com/avatar.webp' },
    now: NOW,
  });
  const second = buildCommunityDiscoveryRanking({
    rawCommunity: community(),
    rawDiscovery: { avatarUrl: 'https://cdn.example.com/avatar.webp' },
    now: NOW,
  });

  assert.deepEqual(first, second);
});
