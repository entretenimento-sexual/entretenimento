// functions/src/community/community-discovery-exposure-retention.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityDiscoveryExposureRetentionSweep,
  COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_MAX_DAYS_PER_RUN,
  resolveCommunityDiscoveryExposureRetentionCutoffDay,
} from './community-discovery-exposure-retention.policy';

const NOW = Date.UTC(2026, 8, 2, 15, 0, 0);

test('retém 35 dias e seleciona somente o dia que saiu da janela no primeiro ciclo', () => {
  assert.equal(
    resolveCommunityDiscoveryExposureRetentionCutoffDay(NOW),
    '2026-07-29'
  );
  assert.deepEqual(
    buildCommunityDiscoveryExposureRetentionSweep({ now: NOW }),
    ['2026-07-29']
  );
});

test('recupera dias perdidos a partir do cursor sem ultrapassar o cutoff', () => {
  assert.deepEqual(
    buildCommunityDiscoveryExposureRetentionSweep({
      now: NOW,
      lastPrunedDay: '2026-07-26',
    }),
    ['2026-07-27', '2026-07-28', '2026-07-29']
  );
});

test('não repete expurgo quando o cursor já alcançou o cutoff', () => {
  assert.deepEqual(
    buildCommunityDiscoveryExposureRetentionSweep({
      now: NOW,
      lastPrunedDay: '2026-07-29',
    }),
    []
  );
});

test('limita catch-up para manter o scheduler previsível', () => {
  const days = buildCommunityDiscoveryExposureRetentionSweep({
    now: NOW,
    lastPrunedDay: '2026-01-01',
  });

  assert.equal(days.length, COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_MAX_DAYS_PER_RUN);
  assert.equal(days[0], '2026-01-02');
});

test('ignora cursor malformado e volta ao comportamento seguro de primeiro ciclo', () => {
  assert.deepEqual(
    buildCommunityDiscoveryExposureRetentionSweep({
      now: NOW,
      lastPrunedDay: 'nao-e-data',
    }),
    ['2026-07-29']
  );
});
