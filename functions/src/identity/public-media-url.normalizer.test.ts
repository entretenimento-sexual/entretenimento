import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePublicIdentityMediaUrl } from './public-media-url.normalizer';

test('aceita HTTPS para mídia pública de identidade', () => {
  assert.equal(
    normalizePublicIdentityMediaUrl('https://cdn.example.test/avatar.jpg'),
    'https://cdn.example.test/avatar.jpg'
  );
});

test('aceita HTTP somente em hosts loopback usados pelo Emulator', () => {
  assert.equal(
    normalizePublicIdentityMediaUrl('http://127.0.0.1:9199/v0/b/demo/o/avatar.jpg'),
    'http://127.0.0.1:9199/v0/b/demo/o/avatar.jpg'
  );
  assert.equal(
    normalizePublicIdentityMediaUrl('http://localhost:9199/v0/b/demo/o/avatar.jpg'),
    'http://localhost:9199/v0/b/demo/o/avatar.jpg'
  );
  assert.equal(
    normalizePublicIdentityMediaUrl('http://[::1]:9199/v0/b/demo/o/avatar.jpg'),
    'http://[::1]:9199/v0/b/demo/o/avatar.jpg'
  );
});

test('rejeita HTTP externo e protocolos não web', () => {
  assert.equal(
    normalizePublicIdentityMediaUrl('http://cdn.example.test/avatar.jpg'),
    null
  );
  assert.equal(
    normalizePublicIdentityMediaUrl('javascript:alert(1)'),
    null
  );
  assert.equal(normalizePublicIdentityMediaUrl(''), null);
});
