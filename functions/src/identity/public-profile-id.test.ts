import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generatePublicProfileId,
  normalizePublicProfileId,
  resolveOrGeneratePublicProfileId,
} from './public-profile-id';

test('gera identificador público opaco no formato canônico', () => {
  const profileId = generatePublicProfileId();

  assert.match(
    profileId,
    /^profile-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.equal(normalizePublicProfileId(profileId), profileId);
});

test('preserva profileId canônico existente', () => {
  const profileId = 'profile-550e8400-e29b-41d4-a716-446655440000';
  assert.equal(resolveOrGeneratePublicProfileId(profileId), profileId);
});

test('não aceita UID ou identificador arbitrário como profileId', () => {
  assert.equal(normalizePublicProfileId('firebase-auth-uid'), null);
  assert.equal(normalizePublicProfileId('profile-123'), null);
});
