import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductCalibrationRuntimeObservation,
} from './product-calibration-observation.policy';

test('normaliza observação real sem identidade do usuário', () => {
  assert.deepEqual(
    buildProductCalibrationRuntimeObservation({
      metric: 'community.projection.derived_writes_per_source_event',
      value: 2.34567,
      source: 'notification summary',
    }),
    {
      metric: 'community.projection.derived_writes_per_source_event',
      value: 2.3457,
      source: 'notification_summary',
      semantics: 'production_runtime_observation',
    }
  );
});

test('falha para zero seguro quando valor não é observável', () => {
  assert.equal(
    buildProductCalibrationRuntimeObservation({
      metric: 'community.notification.grouped_activities_per_push',
      value: Number.NaN,
      source: '',
    }).value,
    0
  );
});
