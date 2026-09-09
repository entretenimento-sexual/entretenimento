import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPushTokenOwnershipBackfillOwner,
  decidePushTokenOwnershipBackfill,
  PUSH_TOKEN_OWNERSHIP_BACKFILL_SOURCE,
  resolvePushTokenOwnershipBackfillCandidate,
} from './push-token-ownership-backfill.policy';
import { PUSH_TOKEN_OWNER_SCHEMA_VERSION } from './push-device.policy';

const TOKEN = 'fcm-token-value-that-is-long-enough-for-backfill-1234567890';
const NOW = 2_000_000_000_000;
const DEVICE_A = 'a'.repeat(64);
const DEVICE_B = 'b'.repeat(64);
const PATH_A = `users/user-a/push_devices/${DEVICE_A}`;
const PATH_B = `users/user-b/push_devices/${DEVICE_B}`;

function candidate(path: string, lastSeenAtMs: number) {
  const resolved = resolvePushTokenOwnershipBackfillCandidate(
    path,
    {token: TOKEN, lastSeenAt: lastSeenAtMs},
    NOW
  );

  assert.ok(resolved.candidate);
  return resolved.candidate;
}

test('aceita somente registro push_devices ativo com token e caminho canônicos', () => {
  const resolved = resolvePushTokenOwnershipBackfillCandidate(
    PATH_A,
    {
      token: TOKEN,
      lastSeenAt: {toMillis: () => NOW - 1_000},
    },
    NOW
  );

  assert.equal(resolved.reason, null);
  assert.deepEqual(resolved.candidate, {
    uid: 'user-a',
    deviceId: DEVICE_A,
    devicePath: PATH_A,
    token: TOKEN,
    lastSeenAtMs: NOW - 1_000,
  });
});

test('ignora path, token e lastSeenAt sem evidência suficiente', () => {
  assert.equal(
    resolvePushTokenOwnershipBackfillCandidate(
      `users/user-a/devices/${DEVICE_A}`,
      {token: TOKEN, lastSeenAt: NOW - 1_000},
      NOW
    ).reason,
    'invalid_path'
  );
  assert.equal(
    resolvePushTokenOwnershipBackfillCandidate(
      PATH_A,
      {token: 'short', lastSeenAt: NOW - 1_000},
      NOW
    ).reason,
    'invalid_token'
  );
  assert.equal(
    resolvePushTokenOwnershipBackfillCandidate(
      PATH_A,
      {token: TOKEN},
      NOW
    ).reason,
    'invalid_last_seen'
  );
  assert.equal(
    resolvePushTokenOwnershipBackfillCandidate(
      PATH_A,
      {token: TOKEN, lastSeenAt: NOW + 1},
      NOW
    ).reason,
    'invalid_last_seen'
  );
});

test('ignora dispositivo stale para não canonizar instalação já inativa', () => {
  const thirtyOneDays = 31 * 24 * 60 * 60 * 1000;

  assert.equal(
    resolvePushTokenOwnershipBackfillCandidate(
      PATH_A,
      {token: TOKEN, lastSeenAt: NOW - thirtyOneDays},
      NOW
    ).reason,
    'stale'
  );
});

test('owner ausente pode ser criado pelo backfill', () => {
  assert.deepEqual(
    decidePushTokenOwnershipBackfill(false, undefined, candidate(PATH_A, NOW - 2_000)),
    {action: 'claim', reason: 'missing_owner'}
  );
});

test('ownership criado pelo runtime nunca é substituído pelo backfill', () => {
  const currentOwner = {
    uid: 'user-b',
    deviceId: DEVICE_B,
    schemaVersion: PUSH_TOKEN_OWNER_SCHEMA_VERSION,
  };

  assert.deepEqual(
    decidePushTokenOwnershipBackfill(
      true,
      currentOwner,
      candidate(PATH_A, NOW - 1_000)
    ),
    {action: 'skip', reason: 'canonical_owner_present'}
  );
});

test('owner existente e malformado falha fechado durante a migração', () => {
  assert.deepEqual(
    decidePushTokenOwnershipBackfill(
      true,
      {
        uid: 'user-b',
        deviceId: 'invalid',
        schemaVersion: PUSH_TOKEN_OWNER_SCHEMA_VERSION,
      },
      candidate(PATH_A, NOW - 1_000)
    ),
    {action: 'skip', reason: 'malformed_owner'}
  );
});

test('registro legado mais recente substitui somente owner criado pelo backfill', () => {
  const olderCandidate = candidate(PATH_A, NOW - 5_000);
  const newerCandidate = candidate(PATH_B, NOW - 1_000);
  const backfilledOwner = buildPushTokenOwnershipBackfillOwner(olderCandidate);

  assert.equal(
    backfilledOwner.migrationSource,
    PUSH_TOKEN_OWNERSHIP_BACKFILL_SOURCE
  );
  assert.deepEqual(
    decidePushTokenOwnershipBackfill(
      true,
      backfilledOwner,
      newerCandidate
    ),
    {action: 'replace', reason: 'newer_backfill_candidate'}
  );
});

test('empate de lastSeenAt usa path lexical estável e independe da ordem de varredura', () => {
  const selectedFirst = candidate(PATH_B, NOW - 1_000);
  const lexicalWinner = candidate(PATH_A, NOW - 1_000);
  const backfilledOwner = buildPushTokenOwnershipBackfillOwner(selectedFirst);

  assert.deepEqual(
    decidePushTokenOwnershipBackfill(
      true,
      backfilledOwner,
      lexicalWinner
    ),
    {action: 'replace', reason: 'deterministic_tie_break'}
  );
  assert.deepEqual(
    decidePushTokenOwnershipBackfill(
      true,
      buildPushTokenOwnershipBackfillOwner(lexicalWinner),
      selectedFirst
    ),
    {action: 'skip', reason: 'older_or_equal_backfill_candidate'}
  );
});
