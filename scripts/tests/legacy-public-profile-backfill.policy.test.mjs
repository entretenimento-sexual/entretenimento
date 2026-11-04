import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const legacyScript = fileURLToPath(
  new URL('../maintenance/backfill-public-profile-discovery-admin.mjs', import.meta.url)
);

for (const scenario of [
  {
    name: 'projeto local, escrita solicitada',
    host: '127.0.0.1:8080',
    project: 'entretenimento-sexual',
    dryRun: 'false',
  },
  {
    name: 'projeto remoto, escrita solicitada',
    host: '',
    project: 'entretenimento-sexual',
    dryRun: 'false',
  },
  {
    name: 'projeto local, apenas leitura solicitada',
    host: '127.0.0.1:8080',
    project: 'entretenimento-sexual',
    dryRun: 'true',
  },
]) {
  test(`backfill legado falha fechado: ${scenario.name}`, () => {
    const result = spawnSync(process.execPath, [legacyScript], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        PATH: process.env.PATH ?? '',
        FIREBASE_PROJECT_ID: scenario.project,
        FIRESTORE_EMULATOR_HOST: scenario.host,
        BACKFILL_DRY_RUN: scenario.dryRun,
      },
    });

    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /BLOQUEADO: script legado desativado/);
    assert.match(result.stderr, /Nenhum dado foi lido ou alterado/);
  });
}
