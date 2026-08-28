import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPublicUserIdentity } from './public-user-identity.model';

test('hidrata avatar loopback do public_profile para superfícies sociais', () => {
  const emulatorUrl = 'http://localhost:9199/v0/b/demo-project/o/users%2Fu1%2Favatar.webp?alt=media';
  const identity = buildPublicUserIdentity({
    nickname: 'serale',
    avatarUrl: emulatorUrl,
  }, {
    label: 'Participante',
    avatarUrl: null,
  });

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
