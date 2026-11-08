import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRIVATE_DISCOVERY_INTEREST_FIELDS } from '../discovery/public-profile-discovery-projection';

import {
  isCurrentCommunityMemberPublicProfile,
} from './get-community-member-roster-page.handler';

const NOW = 1_800_000_000_000;
const PROFILE_ID = 'profile-00000000-0000-4000-8000-000000000001';

describe('community member roster public profile boundary', () => {
  it('usa existência e identidade pública canônica, sem assurance etário local', () => {
    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        { profileId: PROFILE_ID },
        NOW
      ),
      true
    );
    assert.equal(
      isCurrentCommunityMemberPublicProfile(
        { profileId: 'invalid-profile-id' },
        NOW
      ),
      false
    );
    assert.equal(
      isCurrentCommunityMemberPublicProfile(null, NOW),
      false
    );
  });
  it('nega presença de qualquer uma das 21 preferências privadas, inclusive null', () => {
    for (const key of PRIVATE_DISCOVERY_INTEREST_FIELDS) {
      assert.equal(isCurrentCommunityMemberPublicProfile({
        profileId: PROFILE_ID, [key]: null,
      }, NOW), false, key);
    }
  });

});
