import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('direct chat reconciliation CLI — fail-closed operational boundary', () => {
  const cli = join(__dirname, 'direct-chat-reconciliation.emulator-cli.js');
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    GCLOUD_PROJECT: 'demo-entretenimento',
    GOOGLE_CLOUD_PROJECT: 'demo-entretenimento',
  };
  delete base.GCP_PROJECT;
  delete base.FIREBASE_CONFIG;

  function denied(
    overrides: Record<string, string | undefined>,
    args: string[] = ['alice', 'bob']
  ) {
    const env = { ...base, ...overrides };
    const result = spawnSync(process.execPath, [cli, ...args], {
      env, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Falha no dry-run: Error:/);
    assert.doesNotMatch(result.stdout, /pairHash|eligibleChatIds/);
  }

  it('não serializa identificadores de pares ou de conversas no resumo', () => {
    const source = readFileSync(join(__dirname, 'direct-chat-reconciliation.emulator-cli.js'), 'utf8');
    assert.match(source, /eligibleHistoryCount/);
    assert.match(source, /requiresManualReview/);
    assert.doesNotMatch(source, /JSON\\.stringify\\(report, null, 2\\)/);
  });

  it('rejeita host ausente ou remoto antes de consultar Firestore', () => {
    denied({ FIRESTORE_EMULATOR_HOST: undefined });
    denied({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' });
    denied({ FIRESTORE_EMULATOR_HOST: 'http://127.0.0.1:8080' });
  });

  it('rejeita portas fora da faixa e host que imita loopback', () => {
    denied({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:65536' });
    denied({ FIRESTORE_EMULATOR_HOST: '127.0.0.1.evil.example:8080' });
  });

  it('rejeita projeto ausente, produção e projetos inconsistentes', () => {
    denied({ GCLOUD_PROJECT: undefined, GOOGLE_CLOUD_PROJECT: undefined });
    denied({ GCLOUD_PROJECT: 'entretenimento-prod' });
    denied({ GCP_PROJECT: 'entretenimento-prod' });
  });

  it('rejeita FIREBASE_CONFIG conflitante ou inválido', () => {
    denied({ FIREBASE_CONFIG: '{"projectId":"entretenimento-prod"}' });
    denied({ FIREBASE_CONFIG: 'not-json' });
  });

  it('rejeita varredura, par idêntico e UIDs inseguros', () => {
    denied({}, []);
    denied({}, ['alice']);
    denied({}, ['alice', 'bob', 'carol']);
    denied({}, ['alice', 'alice']);
    denied({}, ['a/b', 'bob']);
    denied({}, ['alice\nroot', 'bob']);
  });
});
