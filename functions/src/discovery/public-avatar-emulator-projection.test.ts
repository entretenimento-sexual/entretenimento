import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPublicAvatarProjection } from './public-profile-discovery-projection';

test('projeta avatar do Storage Emulator sem relaxar HTTP externo', () => {
  const emulatorUrl = 'http://127.0.0.1:9199/v0/b/demo-project/o/users%2Fu1%2Favatar.webp?alt=media';

  assert.deepEqual(buildPublicAvatarProjection({
    avatarUrl: emulatorUrl,
  }), {
    avatarUrl: emulatorUrl,
    photoURL: emulatorUrl,
  });

  assert.deepEqual(buildPublicAvatarProjection({
    avatarUrl: 'http://cdn.example.test/avatar.webp',
  }), {
    avatarUrl: null,
    photoURL: null,
  });
});
