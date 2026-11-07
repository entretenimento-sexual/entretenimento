import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBackfillDryRun } from './backfill-public-profile-discovery.handler';

test('backfill administrativo é read-only quando dryRun não é fornecido', () => {
  assert.equal(normalizeBackfillDryRun(undefined), true);
  assert.equal(normalizeBackfillDryRun(null), true);
});

test('payload inválido não é interpretado como autorização de escrita', () => {
  assert.equal(normalizeBackfillDryRun('false'), true);
  assert.equal(normalizeBackfillDryRun(0), true);
  assert.equal(normalizeBackfillDryRun({}), true);
});

test('backfill de discovery não autoriza escrita nem após false explícito', () => {
  assert.equal(normalizeBackfillDryRun(true), true);
  assert.equal(normalizeBackfillDryRun(false), true);
});
