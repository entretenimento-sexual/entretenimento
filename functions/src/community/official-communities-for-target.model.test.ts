import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeOfficialCommunitiesForTargetRequest,
} from './official-communities-for-target.model';

test('normaliza profileId canônico e limita quantidade de cards', () => {
  assert.deepEqual(
    normalizeOfficialCommunitiesForTargetRequest({
      target: {
        type: 'profile',
        id: ' profile-11111111-1111-4111-8111-111111111111 ',
      },
      limit: 99,
    }),
    {
      target: {
        type: 'profile',
        id: 'profile-11111111-1111-4111-8111-111111111111',
      },
      limit: 12,
    }
  );
});

test('aceita alvos oficiais genéricos com identificador seguro', () => {
  assert.deepEqual(
    normalizeOfficialCommunitiesForTargetRequest({
      target: { type: 'venue', id: 'venue-request_1234567890' },
    }),
    {
      target: { type: 'venue', id: 'venue-request_1234567890' },
      limit: 4,
    }
  );

  assert.deepEqual(
    normalizeOfficialCommunitiesForTargetRequest({
      target: { type: 'event', id: 'event:2026:rj:001' },
      limit: 6,
    }),
    {
      target: { type: 'event', id: 'event:2026:rj:001' },
      limit: 6,
    }
  );
});

test('rejeita uid arbitrário quando o alvo é profile', () => {
  assert.equal(
    normalizeOfficialCommunitiesForTargetRequest({
      target: { type: 'profile', id: 'user-123' },
    }),
    null
  );
});

test('rejeita tipo ou identificador inseguro', () => {
  assert.equal(
    normalizeOfficialCommunitiesForTargetRequest({
      target: { type: 'room', id: 'room-1' },
    }),
    null
  );

  assert.equal(
    normalizeOfficialCommunitiesForTargetRequest({
      target: { type: 'venue', id: 'venues/outro' },
    }),
    null
  );
});
