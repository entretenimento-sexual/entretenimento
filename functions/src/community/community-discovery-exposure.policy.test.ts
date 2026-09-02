// functions/src/community/community-discovery-exposure.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_DISCOVERY_EXPOSURE_BATCH_SIZE,
  COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS,
  isCommunityDiscoveryExposureEligibleProjection,
  normalizeCommunityDiscoveryExposureRequest,
  normalizeCommunityDiscoveryExposureShard,
  resolveCommunityDiscoveryExposureDay,
} from './community-discovery-exposure.policy';

test('normaliza lote pequeno, remove duplicatas e preserva sourceType', () => {
  assert.deepEqual(
    normalizeCommunityDiscoveryExposureRequest({
      sourceType: 'community',
      communityIds: ['community-1', 'community-1', 'community-2'],
    }),
    {
      sourceType: 'community',
      communityIds: ['community-1', 'community-2'],
    }
  );
});

test('rejeita lote vazio, excessivo, origem inválida ou identificador inseguro', () => {
  assert.equal(
    normalizeCommunityDiscoveryExposureRequest({
      sourceType: 'community',
      communityIds: [],
    }),
    null
  );
  assert.equal(
    normalizeCommunityDiscoveryExposureRequest({
      sourceType: 'community',
      communityIds: Array.from(
        { length: COMMUNITY_DISCOVERY_EXPOSURE_BATCH_SIZE + 1 },
        (_, index) => `community-${index}`
      ),
    }),
    null
  );
  assert.equal(
    normalizeCommunityDiscoveryExposureRequest({
      sourceType: 'room',
      communityIds: ['community-1'],
    }),
    null
  );
  assert.equal(
    normalizeCommunityDiscoveryExposureRequest({
      sourceType: 'venue',
      communityIds: ['../venue-1'],
    }),
    null
  );
});

test('aceita somente projeção pública ativa da mesma origem', () => {
  const projection = {
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    source: { type: 'community' },
  };

  assert.equal(
    isCommunityDiscoveryExposureEligibleProjection(projection, 'community'),
    true
  );
  assert.equal(
    isCommunityDiscoveryExposureEligibleProjection(projection, 'venue'),
    false
  );
  assert.equal(
    isCommunityDiscoveryExposureEligibleProjection(
      { ...projection, moderationState: 'blocked' },
      'community'
    ),
    false
  );
});

test('usa o dia civil de São Paulo, inclusive próximo da virada UTC', () => {
  assert.equal(
    resolveCommunityDiscoveryExposureDay(Date.UTC(2026, 8, 3, 1, 30, 0)),
    '2026-09-02'
  );
  assert.equal(
    resolveCommunityDiscoveryExposureDay(Date.UTC(2026, 8, 3, 3, 30, 0)),
    '2026-09-03'
  );
});

test('mantém índice de shard dentro da faixa configurada', () => {
  assert.equal(normalizeCommunityDiscoveryExposureShard(-1), 0);
  assert.equal(normalizeCommunityDiscoveryExposureShard(3.8), 3);
  assert.equal(
    normalizeCommunityDiscoveryExposureShard(999),
    COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS - 1
  );
});
