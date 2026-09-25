import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isCurrentCommunityMemberPublicProfile } from './community-member-public-profile.policy';

describe('community member public profile policy', () => {
  const nowMs = 1_800_000_000_000;

  it('aceita somente perfil adulto verificado ainda vigente', () => {
    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        {
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: nowMs + 60_000,
        },
        nowMs
      ),
      true
    );
  });

  it('recusa perfil expirado, não verificado ou ausente', () => {
    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        {
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: nowMs,
        },
        nowMs
      ),
      false
    );
    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        {
          ageEligibilityVerifiedAdult: false,
          ageEligibilityValidUntil: nowMs + 60_000,
        },
        nowMs
      ),
      false
    );
    assert.equal(isCurrentCommunityMemberPublicProfile(null, nowMs), false);
  });
});
