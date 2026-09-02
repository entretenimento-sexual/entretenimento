// functions/src/community/community-ranking-exposure-diagnostics.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCommunityRankingExposureDiagnostics } from './community-ranking-exposure-diagnostics.policy';

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1_000;

test('mede concentração e exposição de comunidades novas sem IDs', () => {
  const diagnostics = buildCommunityRankingExposureDiagnostics({
    now: NOW,
    entries: [
      { exposureCount: 50, communityCreatedAt: NOW - 5 * DAY_MS },
      { exposureCount: 30, communityCreatedAt: NOW - 90 * DAY_MS },
      { exposureCount: 20, communityCreatedAt: NOW - 10 * DAY_MS },
      { exposureCount: 0, communityCreatedAt: NOW - 200 * DAY_MS },
    ],
  });
  const serialized = JSON.stringify(diagnostics);

  assert.equal(diagnostics.totalQualifiedExposures, 100);
  assert.equal(diagnostics.exposedCommunityCount, 3);
  assert.equal(diagnostics.zeroExposureCommunityCount, 1);
  assert.equal(diagnostics.topRankedFiveExposureShare, 100);
  assert.equal(diagnostics.exposureHhi, 3800);
  assert.equal(diagnostics.knownAgeExposureShare, 100);
  assert.equal(diagnostics.newCommunityExposureShare, 70);
  assert.equal(serialized.includes('communityId'), false);
});

test('explicita cobertura de idade parcial pela parcela de exposições conhecidas', () => {
  const diagnostics = buildCommunityRankingExposureDiagnostics({
    now: NOW,
    entries: [
      { exposureCount: 60, communityCreatedAt: null },
      { exposureCount: 40, communityCreatedAt: NOW - 2 * DAY_MS },
    ],
  });

  assert.equal(diagnostics.knownAgeExposureShare, 40);
  assert.equal(diagnostics.newCommunityExposureShare, 100);
});

test('retorna zeros estáveis quando ainda não há telemetria', () => {
  const diagnostics = buildCommunityRankingExposureDiagnostics({
    now: NOW,
    entries: [
      { exposureCount: 0, communityCreatedAt: NOW - DAY_MS },
      { exposureCount: 0, communityCreatedAt: NOW - 60 * DAY_MS },
    ],
  });

  assert.equal(diagnostics.totalQualifiedExposures, 0);
  assert.equal(diagnostics.topRankedFiveExposureShare, 0);
  assert.equal(diagnostics.exposureHhi, 0);
  assert.equal(diagnostics.newCommunityExposureShare, 0);
});
