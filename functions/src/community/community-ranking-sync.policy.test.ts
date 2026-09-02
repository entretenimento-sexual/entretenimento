// functions/src/community/community-ranking-sync.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION } from './community-ranking-candidate-v3.policy';
import {
  buildCommunityRankingProjectionPatch,
  haveCommunityRankingVisualInputsChanged,
  isCommunityRankingProjectionCurrent,
  isCommunityRankingRuntimeCurrent,
  isCommunityRankingSupportedDocument,
  resolveCommunityRankingMaxPerRun,
} from './community-ranking-sync.policy';
import { COMMUNITY_DISCOVERY_SCORE_VERSION } from './community-ranking.policy';

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

function community(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Comunidade ativa com contexto suficiente para descoberta.',
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderation: { state: 'active' },
    metrics: { memberCount: 20, postCount: 30, mediaCount: 4 },
    lifecycle: { lastMeaningfulActivityAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('gera score v2 autoritativo e candidato v3 shadow no mesmo patch', () => {
  const patch = buildCommunityRankingProjectionPatch(
    community(),
    { avatarUrl: 'https://cdn.example.com/avatar.webp' },
    NOW
  );

  assert.equal(patch.discoveryScore, patch.ranking.discoveryScore);
  assert.equal('rankScore' in patch, false);
  assert.equal(patch.ranking.scoreUpdatedAt, NOW);
  assert.equal(patch.ranking.scoreVersion, COMMUNITY_DISCOVERY_SCORE_VERSION);
  assert.equal(
    patch.rankingCandidate.scoreVersion,
    COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION
  );
  assert.equal(
    patch.rankingCandidate.activityBaseline.memberCount,
    20
  );
});

test('considera projeção atual mesmo com timestamps diagnósticos antigos', () => {
  const expected = buildCommunityRankingProjectionPatch(
    community(),
    {},
    NOW
  );
  const persisted = {
    discoveryScore: expected.discoveryScore,
    ranking: {
      ...expected.ranking,
      scoreUpdatedAt: NOW - 86_400_000,
    },
    rankingCandidate: {
      ...expected.rankingCandidate,
      scoreUpdatedAt: NOW - 86_400_000,
      activityBaseline: {
        ...expected.rankingCandidate.activityBaseline,
        measuredAt: NOW - 86_400_000,
      },
    },
  };

  assert.equal(
    isCommunityRankingProjectionCurrent(persisted, expected),
    true
  );
});

test('detecta mudança material no breakdown autoritativo', () => {
  const expected = buildCommunityRankingProjectionPatch(
    community(),
    {},
    NOW
  );
  const persisted = {
    discoveryScore: expected.discoveryScore,
    ranking: {
      ...expected.ranking,
      activityScore: Math.max(expected.ranking.activityScore - 1, 0),
    },
    rankingCandidate: expected.rankingCandidate,
  };

  assert.equal(
    isCommunityRankingProjectionCurrent(persisted, expected),
    false
  );
});

test('detecta mudança material no candidato v3 sem alterar discoveryScore v2', () => {
  const expected = buildCommunityRankingProjectionPatch(
    community(),
    {},
    NOW
  );
  const persisted = {
    discoveryScore: expected.discoveryScore,
    ranking: expected.ranking,
    rankingCandidate: {
      ...expected.rankingCandidate,
      activityMomentum: {
        ...expected.rankingCandidate.activityMomentum,
        shortTerm: expected.rankingCandidate.activityMomentum.shortTerm + 1,
      },
    },
  };

  assert.equal(
    isCommunityRankingProjectionCurrent(persisted, expected),
    false
  );
  assert.equal(expected.discoveryScore, expected.ranking.discoveryScore);
});

test('trigger visual reage somente a descrição, avatar ou capa', () => {
  const before = {
    description: 'Antes',
    avatarUrl: null,
    coverUrl: null,
    discoveryScore: 10,
  };

  assert.equal(
    haveCommunityRankingVisualInputsChanged(
      before,
      { ...before, discoveryScore: 20 }
    ),
    false
  );
  assert.equal(
    haveCommunityRankingVisualInputsChanged(
      before,
      { ...before, coverUrl: 'https://cdn.example.com/cover.webp' }
    ),
    true
  );
});

test('aceita somente documentos sociais suportados', () => {
  assert.equal(isCommunityRankingSupportedDocument(community()), true);
  assert.equal(
    isCommunityRankingSupportedDocument(
      community({ source: { type: 'venue', id: 'venue-1' } })
    ),
    true
  );
  assert.equal(
    isCommunityRankingSupportedDocument(
      community({ source: { type: 'room', id: 'room-1' } })
    ),
    false
  );
});

test('não reutiliza runtime de backfill de outra versão', () => {
  assert.equal(
    isCommunityRankingRuntimeCurrent({
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      cursor: 'community-500',
    }),
    true
  );
  assert.equal(
    isCommunityRankingRuntimeCurrent({
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION - 1,
      cursor: 'community-500',
    }),
    false
  );
  assert.equal(isCommunityRankingRuntimeCurrent({}), false);
});

test('limita lote diário configurável', () => {
  assert.equal(resolveCommunityRankingMaxPerRun({}), 1_000);
  assert.equal(
    resolveCommunityRankingMaxPerRun({ rankingMaxCommunitiesPerRun: 10 }),
    100
  );
  assert.equal(
    resolveCommunityRankingMaxPerRun({ rankingMaxCommunitiesPerRun: 50_000 }),
    10_000
  );
});
