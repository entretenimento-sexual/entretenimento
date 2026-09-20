import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_RETENTION_CLASSIFICATION,
} from './community-retention-classification.policy';

test('separa evidência durável de artefato operacional com TTL', () => {
  const durable = new Set<string>(
    COMMUNITY_RETENTION_CLASSIFICATION.durableEvidence as readonly string[]
  );

  for (const collection of COMMUNITY_RETENTION_CLASSIFICATION.ttlOperational) {
    assert.equal(
      durable.has(collection),
      false,
      `coleção TTL não pode ser evidência durável: ${collection}`
    );
  }
});

test('projeções de lifecycle não são confundidas com evidência', () => {
  const durable = new Set<string>(
    COMMUNITY_RETENTION_CLASSIFICATION.durableEvidence as readonly string[]
  );

  for (const collection of COMMUNITY_RETENTION_CLASSIFICATION.lifecycleProjection) {
    assert.equal(
      durable.has(collection),
      false,
      `projeção não pode ser retenção probatória: ${collection}`
    );
  }
});

test('telemetria de discovery permanece numa classe própria e agregada', () => {
  assert.deepEqual(
    COMMUNITY_RETENTION_CLASSIFICATION.rollingTelemetry,
    ['community_discovery_exposure_daily']
  );
  assert.equal(
    COMMUNITY_RETENTION_CLASSIFICATION.ttlOperational.includes(
      'community_discovery_exposure_daily'
    ),
    false
  );
});
