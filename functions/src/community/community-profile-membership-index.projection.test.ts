import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityProfileMembershipIndexProjection,
} from './community-profile-membership-index.projection';

test('indexa somente opt-in explícito de membership ativo', () => {
  assert.deepEqual(
    buildCommunityProfileMembershipIndexProjection('community-1', {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 2,
    }),
    { communityId: 'community-1', status: 'candidate' }
  );
});

test('legacy, hidden, left e policy inválida permanecem fora do locator', () => {
  for (const membership of [
    { status: 'active' },
    { status: 'active', profileVisibility: 'hidden' },
    {
      status: 'left',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 2,
    },
    {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 0,
    },
  ]) {
    assert.equal(
      buildCommunityProfileMembershipIndexProjection('community-1', membership),
      null
    );
  }
});
