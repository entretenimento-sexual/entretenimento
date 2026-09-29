import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { preferenceAllowsPublicIntent } from './user-intent-status.handler';

describe('user intent status public visibility authority', () => {
  it('permite descoberta pública somente com opt-in explícito nas preferências', () => {
    assert.equal(
      preferenceAllowsPublicIntent({
        visibility: { showIntentPublicly: true },
      }),
      true
    );

    assert.equal(
      preferenceAllowsPublicIntent({
        visibility: { showIntentPublicly: false },
      }),
      false
    );
  });

  it('falha fechado para perfil ausente ou formato inválido', () => {
    assert.equal(preferenceAllowsPublicIntent(null), false);
    assert.equal(preferenceAllowsPublicIntent({}), false);
    assert.equal(
      preferenceAllowsPublicIntent({ visibility: 'public' }),
      false
    );
  });
});
