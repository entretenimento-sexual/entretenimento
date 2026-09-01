import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPublicUserIdentity } from './public-user-identity.model';

const PROFILE_ID = 'profile-550e8400-e29b-41d4-a716-446655440000';

test('hidrata avatar loopback do public_profile para superfícies sociais', () => {
  const emulatorUrl = 'http://localhost:9199/v0/b/demo-project/o/users%2Fu1%2Favatar.webp?alt=media';
  const identity = buildPublicUserIdentity({
    profileId: PROFILE_ID,
    nickname: 'serale',
    avatarUrl: emulatorUrl,
  }, {
    label: 'Participante',
    avatarUrl: null,
  });

  assert.equal(identity.profileId, PROFILE_ID);
  assert.equal(identity.label, 'serale');
  assert.equal(identity.avatarUrl, emulatorUrl);
});

test('mantém fallback seguro e rejeita avatar HTTP externo', () => {
  const fallbackUrl = 'https://cdn.example.test/fallback.webp';
  const identity = buildPublicUserIdentity({
    nickname: 'serale',
    avatarUrl: 'http://cdn.example.test/inseguro.webp',
  }, {
    label: 'Participante',
    avatarUrl: fallbackUrl,
  });

  assert.equal(identity.avatarUrl, fallbackUrl);
});

test('não promove UID ou identificador arbitrário a profileId público', () => {
  const identity = buildPublicUserIdentity({
    profileId: 'firebase-auth-uid',
    nickname: 'serale',
  }, {
    label: 'Participante',
    avatarUrl: null,
  });

  assert.equal(identity.profileId, null);
});
