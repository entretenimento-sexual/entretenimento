import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUSH_DEVICE_STALE_AFTER_MS,
  resolvePushDeviceFreshnessCutoffMs,
} from './push-device.policy';

test('usa janela canônica de 30 dias para excluir registros stale do envio', () => {
  assert.equal(PUSH_DEVICE_STALE_AFTER_MS, 30 * 24 * 60 * 60 * 1000);
});

test('resolve cutoff de freshness sem depender do relógio real no teste', () => {
  const now = 2_000_000_000_000;

  assert.equal(
    resolvePushDeviceFreshnessCutoffMs(now),
    now - PUSH_DEVICE_STALE_AFTER_MS
  );
});
