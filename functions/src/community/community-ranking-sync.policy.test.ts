// functions/src/community/community-ranking-sync.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION } from './community-ranking-candidate-v3.policy';
import { buildCommunityRankingShadowDiagnostics } from './community-ranking-shadow-diagnostics.policy';
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
const DAY_MS = 24 * 60 * 60 * 1_000;

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
  assert.equal(patch.communityCreatedAt, NOW);
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
  assert.equal(
    patch.rankingCandidate.activityConfidence.modelVersion,
    1
  );
});

test('normaliza timestamp canônico do Firestore na projeção', () => {
  const createdAt = NOW - (45 * DAY_MS);
  const patch = buildCommunityRankingProjectionPatch(
    community({ createdAt: { toMillis: () => createdAt } }),
    {},
    NOW
  );

  assert.equal(patch.communityCreatedAt, createdAt);
});

test('considera projeção atual mesmo com timestamps diagnósticos antigos', () => {
  const expected = buildCommunityRankingProjectionPatch(
    community(),
    {},
    NOW
  );
  const persisted = {
    discoveryScore: expected.discoveryScore,
    communityCreatedAt: expected.communityCreatedAt,
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

test('detecta projeção antiga sem idade canônica e força backfill', () => {
  const expected = buildCommunityRankingProjectionPatch(
    community({ createdAt: NOW - (60 * DAY_MS) }),
    {},
    NOW
  );
  const persisted = {
    discoveryScore: expected.discoveryScore,
    ranking: expected.ranking,
    rankingCandidate: expected.rankingCandidate,
  };

  assert.equal(expected.communityCreatedAt, NOW - (60 * DAY_MS));
  assert.equal(
    isCommunityRankingProjectionCurrent(persisted, expected),
    false
  );
});

test('detecta candidato v3 antigo sem modelo de confiança e força recomputação', () => {
  const expected = buildCommunityRankingProjectionPatch(
    community(),
    {},
    NOW
  );
  const { activityConfidence: _removed, ...legacyCandidate } =
    expected.rankingCandidate;
  const persisted = {
    discoveryScore: expected.discoveryScore,
    communityCreatedAt: expected.communityCreatedAt,
    ranking: expected.ranking,
    rankingCandidate: legacyCandidate,
  };

  assert.equal(
    isCommunityRankingProjectionCurrent(persisted, expected),
    false
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
    communityCreatedAt: expected.communityCreatedAt,
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
    communityCreatedAt: expected.communityCreatedAt,
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

test('diagnóstico shadow reconhece top-K idêntico sem deslocamento', () => {
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: [
      { communityId: 'community-a', score: 90 },
      { communityId: 'community-b', score: 80 },
      { communityId: 'community-c', score: 70 },
    ],
    candidateTop: [
      { communityId: 'community-a', score: 92 },
      { communityId: 'community-b', score: 82 },
      { communityId: 'community-c', score: 72 },
    ],
    topK: 3,
  });

  assert.equal(diagnostics.overlapRate, 100);
  assert.equal(diagnostics.rankAgreement, 100);
  assert.equal(diagnostics.meanAbsoluteRankShift, 0);
  assert.equal(diagnostics.maxAbsoluteRankShift, 0);
  assert.equal(diagnostics.candidateEntrants, 0);
  assert.equal(diagnostics.candidateExits, 0);
  assert.equal(diagnostics.meanCandidateScoreDelta, 2);
});

test('diagnóstico shadow mede reordenação sem confundir com entrada ou saída', () => {
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: [
      { communityId: 'community-a', score: 90 },
      { communityId: 'community-b', score: 80 },
      { communityId: 'community-c', score: 70 },
    ],
    candidateTop: [
      { communityId: 'community-c', score: 95 },
      { communityId: 'community-a', score: 85 },
      { communityId: 'community-b', score: 75 },
    ],
    topK: 3,
  });

  assert.equal(diagnostics.overlapRate, 100);
  assert.equal(diagnostics.meanAbsoluteRankShift, 1.33);
  assert.equal(diagnostics.maxAbsoluteRankShift, 2);
  assert.equal(diagnostics.rankAgreement, 33.33);
  assert.equal(diagnostics.candidateEntrants, 0);
  assert.equal(diagnostics.candidateExits, 0);
});

test('diagnóstico shadow evidencia renovação parcial do top-K', () => {
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: [
      { communityId: 'community-a', score: 90 },
      { communityId: 'community-b', score: 80 },
      { communityId: 'community-c', score: 70 },
    ],
    candidateTop: [
      { communityId: 'community-a', score: 91 },
      { communityId: 'community-d', score: 85 },
      { communityId: 'community-e', score: 84 },
    ],
    topK: 3,
  });

  assert.equal(diagnostics.overlapCount, 1);
  assert.equal(diagnostics.overlapRate, 33.33);
  assert.equal(diagnostics.candidateEntrants, 2);
  assert.equal(diagnostics.candidateExits, 2);
});

test('diagnóstico cold-start mede cobertura e inclui o limite de 30 dias', () => {
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: [
      {
        communityId: 'community-a',
        score: 90,
        communityCreatedAt: NOW - (30 * DAY_MS),
      },
      {
        communityId: 'community-b',
        score: 80,
        communityCreatedAt: NOW - (31 * DAY_MS),
      },
      { communityId: 'community-c', score: 70 },
    ],
    candidateTop: [
      {
        communityId: 'community-a',
        score: 92,
        communityCreatedAt: NOW - (30 * DAY_MS),
      },
      {
        communityId: 'community-d',
        score: 85,
        communityCreatedAt: NOW - DAY_MS,
      },
      {
        communityId: 'community-e',
        score: 84,
        communityCreatedAt: NOW + DAY_MS,
      },
    ],
    topK: 3,
    now: NOW,
  });

  assert.equal(diagnostics.coldStart.windowDays, 30);
  assert.equal(diagnostics.coldStart.officialKnownAgeCount, 2);
  assert.equal(diagnostics.coldStart.candidateKnownAgeCount, 2);
  assert.equal(diagnostics.coldStart.officialAgeCoverageRate, 66.67);
  assert.equal(diagnostics.coldStart.candidateAgeCoverageRate, 66.67);
  assert.equal(diagnostics.coldStart.officialNewCount, 1);
  assert.equal(diagnostics.coldStart.candidateNewCount, 2);
  assert.equal(diagnostics.coldStart.officialNewShare, 50);
  assert.equal(diagnostics.coldStart.candidateNewShare, 100);
  assert.equal(diagnostics.coldStart.newShareDelta, 50);
});

test('diagnóstico cold-start evidencia supressão de comunidades novas', () => {
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: [
      {
        communityId: 'community-new',
        score: 90,
        communityCreatedAt: NOW - DAY_MS,
      },
    ],
    candidateTop: [
      {
        communityId: 'community-old',
        score: 95,
        communityCreatedAt: NOW - (120 * DAY_MS),
      },
    ],
    topK: 1,
    now: NOW,
  });

  assert.equal(diagnostics.coldStart.officialNewShare, 100);
  assert.equal(diagnostics.coldStart.candidateNewShare, 0);
  assert.equal(diagnostics.coldStart.newShareDelta, -100);
});

test('diagnóstico cold-start vazio não fabrica cobertura ou participação', () => {
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: [],
    candidateTop: [],
    topK: 25,
    now: NOW,
  });

  assert.equal(diagnostics.coldStart.officialAgeCoverageRate, 0);
  assert.equal(diagnostics.coldStart.candidateAgeCoverageRate, 0);
  assert.equal(diagnostics.coldStart.officialNewShare, 0);
  assert.equal(diagnostics.coldStart.candidateNewShare, 0);
  assert.equal(diagnostics.coldStart.newShareDelta, 0);
});

test('diagnóstico shadow deduplica IDs e não devolve identificadores', () => {
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: [
      {
        communityId: 'community-a',
        score: 90,
        communityCreatedAt: NOW - DAY_MS,
      },
      {
        communityId: 'community-a',
        score: 89,
        communityCreatedAt: NOW - DAY_MS,
      },
      {
        communityId: 'community-b',
        score: 80,
        communityCreatedAt: NOW - (90 * DAY_MS),
      },
    ],
    candidateTop: [
      {
        communityId: 'community-a',
        score: 92,
        communityCreatedAt: NOW - DAY_MS,
      },
      {
        communityId: 'community-b',
        score: 81,
        communityCreatedAt: NOW - (90 * DAY_MS),
      },
    ],
    topK: 2,
    now: NOW,
  });
  const serialized = JSON.stringify(diagnostics);

  assert.equal(diagnostics.officialTopCount, 2);
  assert.equal(diagnostics.candidateTopCount, 2);
  assert.equal(serialized.includes('community-a'), false);
  assert.equal(serialized.includes('community-b'), false);
  assert.equal(serialized.includes('communityId'), false);
});
