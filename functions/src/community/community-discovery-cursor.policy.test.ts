// functions/src/community/community-discovery-cursor.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityDiscoveryCursor,
  parseCommunityDiscoveryCursor,
} from './community-discovery-cursor.policy';

test('emite e lê cursor opaco vinculado ao modo de ranking', () => {
  const cursor = buildCommunityDiscoveryCursor('score_v2', 'community:123');

  assert.equal(cursor, 'cursor1:score_v2:community:123');
  assert.deepEqual(parseCommunityDiscoveryCursor(cursor), {
    mode: 'score_v2',
    documentId: 'community:123',
    legacyTransport: false,
  });
});

test('preserva cursor antigo somente como transporte legado', () => {
  assert.deepEqual(parseCommunityDiscoveryCursor('community-123'), {
    mode: 'legacy',
    documentId: 'community-123',
    legacyTransport: true,
  });
});

test('aceita envelope legado explícito para rollback sem ambiguidade', () => {
  assert.deepEqual(
    parseCommunityDiscoveryCursor('cursor1:legacy:community-123'),
    {
      mode: 'legacy',
      documentId: 'community-123',
      legacyTransport: false,
    }
  );
});

test('rejeita modo, envelope ou documento inválido', () => {
  assert.equal(parseCommunityDiscoveryCursor('cursor1:score_v0:community-1'), null);
  assert.equal(parseCommunityDiscoveryCursor('cursor2:score_v2:community-1'), null);
  assert.equal(parseCommunityDiscoveryCursor('https://example.com'), null);
  assert.equal(buildCommunityDiscoveryCursor('score_v2', 'bad/id'), null);
});
