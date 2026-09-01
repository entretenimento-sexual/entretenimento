import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeProfileOfficialCommunitiesRequest,
} from './profile-official-communities.model';

const PROFILE_ID = 'profile-123e4567-e89b-42d3-a456-426614174000';

test('normaliza profileId e limita a quantidade pública de cards', () => {
  assert.deepEqual(
    normalizeProfileOfficialCommunitiesRequest({
      profileId: ` ${PROFILE_ID.toUpperCase()} `,
      limit: 99,
    }),
    {
      profileId: PROFILE_ID,
      limit: 12,
    }
  );
});

test('usa limite conservador quando não informado', () => {
  assert.deepEqual(
    normalizeProfileOfficialCommunitiesRequest({ profileId: PROFILE_ID }),
    {
      profileId: PROFILE_ID,
      limit: 4,
    }
  );
});

test('rejeita UID ou identificador público malformado', () => {
  assert.equal(
    normalizeProfileOfficialCommunitiesRequest({
      profileId: 'user-123',
    }),
    null
  );

  assert.equal(
    normalizeProfileOfficialCommunitiesRequest({
      profileId: 'profile-invalid',
    }),
    null
  );
});
