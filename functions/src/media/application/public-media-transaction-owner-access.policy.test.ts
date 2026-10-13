import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertCurrentPublicMediaOwnerLifecycle,
} from './public-media-transaction-owner-access.policy';

describe('media metric transaction account lifecycle', () => {
  it('allows an active admitted account without requiring stronger age assurance', () => {
    for (const assurance of ['SELF_DECLARED_ADULT', 'VERIFIED_ADULT', undefined]) {
      assert.doesNotThrow(() => assertCurrentPublicMediaOwnerLifecycle({
        accountStatus: 'active',
        publicVisibility: 'visible',
        ageEligibilityAssurance: assurance,
      }));
    }
  });

  it('rejects previously issued tokens after the owner is restricted', () => {
    for (const state of [
      null,
      { accountStatus: 'moderation_suspended', suspended: true },
      { accountStatus: 'active', interactionBlocked: true },
      { accountStatus: 'active', accountLocked: true },
      { accountStatus: 'active', loginAllowed: false },
      { accountStatus: 'active', publicVisibility: 'hidden' },
      { accountStatus: 'self_suspended' },
    ]) {
      assert.throws(
        () => assertCurrentPublicMediaOwnerLifecycle(state),
        (error: unknown) => {
          const reason = error as { code?: string };
          return reason.code === 'not-found';
        }
      );
    }
  });
});
