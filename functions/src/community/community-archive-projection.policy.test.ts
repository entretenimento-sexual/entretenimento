// functions/src/community/community-archive-projection.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldCleanupCommunityArchiveProjections } from './community-archive-projection.policy';

test('limpa projeções quando Comunidade entra em archived', () => {
  assert.equal(
    shouldCleanupCommunityArchiveProjections(
      { source: { type: 'community' }, status: 'active' },
      { source: { type: 'community' }, status: 'archived' }
    ),
    true
  );

  assert.equal(
    shouldCleanupCommunityArchiveProjections(
      { source: { type: 'community' }, status: 'dormant' },
      { source: { type: 'community' }, status: 'archived' }
    ),
    true
  );
});

test('não repete fanout em atualização de Comunidade já arquivada', () => {
  assert.equal(
    shouldCleanupCommunityArchiveProjections(
      { source: { type: 'community' }, status: 'archived' },
      { source: { type: 'community' }, status: 'archived' }
    ),
    false
  );
});

test('não aplica lifecycle de Comunidade a Local nem a estado não arquivado', () => {
  assert.equal(
    shouldCleanupCommunityArchiveProjections(
      { source: { type: 'venue' }, status: 'active' },
      { source: { type: 'venue' }, status: 'archived' }
    ),
    false
  );
  assert.equal(
    shouldCleanupCommunityArchiveProjections(
      { source: { type: 'community' }, status: 'active' },
      { source: { type: 'community' }, status: 'paused' }
    ),
    false
  );
});
