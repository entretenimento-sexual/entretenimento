import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeProfileOfficialCommunitiesRequest,
} from './profile-official-communities.model';

test('normaliza perfil e limita a quantidade pública de cards', () => {
  assert.deepEqual(
    normalizeProfileOfficialCommunitiesRequest({
      profileUid: ' user-123 ',
      limit: 99,
    }),
    {
      profileUid: 'user-123',
      limit: 12,
    }
  );
});

test('usa limite conservador quando não informado', () => {
  assert.deepEqual(
    normalizeProfileOfficialCommunitiesRequest({ profileUid: 'user-123' }),
    {
      profileUid: 'user-123',
      limit: 4,
    }
  );
});

test('rejeita identificador de documento inseguro', () => {
  assert.equal(
    normalizeProfileOfficialCommunitiesRequest({
      profileUid: 'users/outro',
    }),
    null
  );
});
