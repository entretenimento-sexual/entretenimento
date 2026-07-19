// functions/src/community/community-user-index.projection.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCommunityUserIndexProjection } from './community-user-index.projection';

test('projeta somente membership ativo com papel reconhecido', () => {
  const result = buildCommunityUserIndexProjection(
    'community-rj',
    {
      name: 'Comunidade RJ',
      source: { type: 'community', id: 'community-rj' },
    },
    { status: 'active', role: 'moderator' }
  );

  assert.deepEqual(result, {
    communityId: 'community-rj',
    name: 'Comunidade RJ',
    source: { type: 'community', id: 'community-rj' },
    role: 'moderator',
    status: 'active',
  });
});

test('aceita Local no índice privado sem transformá-lo em Comunidade', () => {
  const result = buildCommunityUserIndexProjection(
    'community-local-1',
    {
      name: 'Local Centro',
      source: { type: 'venue', id: 'venue-centro' },
    },
    { status: 'active', role: 'owner' }
  );

  assert.equal(result?.source.type, 'venue');
  assert.equal(result?.role, 'owner');
});

test('rejeita vínculo pendente, papel inválido ou origem Sala', () => {
  assert.equal(
    buildCommunityUserIndexProjection(
      'community-rj',
      {
        name: 'Comunidade RJ',
        source: { type: 'community', id: 'community-rj' },
      },
      { status: 'pending', role: 'member' }
    ),
    null
  );

  assert.equal(
    buildCommunityUserIndexProjection(
      'community-rj',
      {
        name: 'Comunidade RJ',
        source: { type: 'room', id: 'room-1' },
      },
      { status: 'active', role: 'member' }
    ),
    null
  );
});
