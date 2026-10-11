import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';

const SAFE_FAILURE = 'Falha no dry-run: operação não concluída.\n';

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

  function assertSafeFailure(
    result: Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr'>,
    secrets: string[] = []
  ): void {
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, SAFE_FAILURE);
    for (const secret of secrets) {
      assert.ok(!result.stderr.includes(secret), 'CLI expôs identificador em stderr');
    }
  }

  function denied(
    overrides: Record<string, string | undefined>,
    args: string[] = ['alice', 'bob']
  ) {
    const env = { ...base, ...overrides };
    const result = spawnSync(process.execPath, [cli, ...args], {
      env, encoding: 'utf8', timeout: 10000,
    });
    assertSafeFailure(result, args);
  }

  it('encerra por deadline quando o servidor aceita conexão sem responder', async () => {
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      // O CLI encerra a conexão pendente ao atingir o deadline.
      // ECONNRESET é esperado no socket do servidor TCP simulado.
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const secretUid = 'private-uid-timeout';
      const child = spawn(process.execPath, [cli, secretUid, 'other-user'], {
        env: {
          ...base,
          FIRESTORE_EMULATOR_HOST: `127.0.0.1:${address.port}`,
          NODE_NO_WARNINGS: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      const started = Date.now();
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const watchdog = setTimeout(() => {
          child.kill();
          reject(new Error('CLI não encerrou dentro do watchdog de teste'));
        }, 12500);
        child.on('error', (error) => { clearTimeout(watchdog); reject(error); });
        child.on('close', (code) => { clearTimeout(watchdog); resolve(code); });
      });
      const elapsed = Date.now() - started;
      assertSafeFailure({ status: exitCode, stdout, stderr }, [secretUid]);
      assert.ok(elapsed >= 7500 && elapsed < 12500, `deadline inválido: ${elapsed}ms`);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('falha fechado quando o Firestore Emulator não está acessível', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
    const secretUid = 'private-uid-connection-failure';
    const result = spawnSync(process.execPath, [cli, secretUid, 'other-user'], {
      encoding: 'utf8',
      timeout: 14000,
      env: {
        ...base,
        FIRESTORE_EMULATOR_HOST: `127.0.0.1:${address.port}`,
        NODE_NO_WARNINGS: '1',
      },
    });
    assert.equal(result.error, undefined, String(result.error));
    assertSafeFailure(result, [secretUid]);
  });

  it('não propaga dados maliciosos dos argumentos em mensagens de erro', () => {
    const secret = 'private-uid-123';
    denied({}, [secret, secret]);
    denied({ FIRESTORE_EMULATOR_HOST: 'remote.example:8080' }, [secret, 'other']);
  });

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
