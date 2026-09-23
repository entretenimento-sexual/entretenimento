import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REGISTRATION_FLOW_VERSION,
  buildInitialUserSeed,
} from './user-registration-seed';

describe('user-registration-seed', () => {
  it('cria conta privada e sem interação social até concluir onboarding', () => {
    const seed = buildInitialUserSeed({
      uid: 'user-1',
      email: 'user@example.com',
      emailVerified: false,
      photoURL: null,
      providerData: [],
    } as any, {
      nowMs: 1_800_000_000_000,
      source: 'registration-recovery',
    });

    assert.equal(
      REGISTRATION_FLOW_VERSION,
      'v3-private-by-default'
    );
    assert.equal(seed['profileCompleted'], false);
    assert.equal(seed['initialAdultConsentRequired'], true);
    assert.equal(seed['registrationCompletedAt'], null);
    assert.equal(seed['publicVisibility'], 'hidden');
    assert.equal(seed['interactionBlocked'], true);
    assert.equal(seed['loginAllowed'], true);
  });
});
