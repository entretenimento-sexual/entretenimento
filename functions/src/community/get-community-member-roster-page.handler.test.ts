import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCurrentCommunityMemberPublicProfile,
} from './get-community-member-roster-page.handler';

const NOW = 1_800_000_000_000;

describe('community member roster temporal age boundary', () => {
  it('inclui somente perfil público adulto com validade futura', () => {
    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        {
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: { toMillis: () => NOW + 60_000 },
        },
        NOW
      ),
      true
    );

    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        {
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: { toMillis: () => NOW },
        },
        NOW
      ),
      false
    );

    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        {
          ageEligibilityVerifiedAdult: false,
          ageEligibilityValidUntil: { toMillis: () => NOW + 60_000 },
        },
        NOW
      ),
      false
    );

    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        {
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: null,
        },
        NOW
      ),
      false
    );
  });
});
