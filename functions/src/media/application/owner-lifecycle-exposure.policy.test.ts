import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateCanonicalOwnerLifecycle } from './owner-lifecycle-exposure.policy';

describe('owner-lifecycle-exposure.policy', () => {
  it('permite somente conta canônica ativa e pública', () => {
    assert.equal(
      evaluateCanonicalOwnerLifecycle({
        accountStatus: 'active',
        suspended: false,
        publicVisibility: 'visible',
        loginAllowed: true,
      }).allowed,
      true
    );
  });

  it('nega projeção pública residual quando lifecycle canônico não permite exposição', () => {
    for (const user of [
      null,
      { accountStatus: 'pending_deletion' },
      { accountStatus: 'active', suspended: true },
      { accountStatus: 'active', publicVisibility: 'hidden' },
      { accountStatus: 'active', loginAllowed: false },
    ]) {
      assert.equal(evaluateCanonicalOwnerLifecycle(user).allowed, false);
    }
  });
});
