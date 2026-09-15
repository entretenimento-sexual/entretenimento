// functions/src/community/community-canonical-owner.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCommunityCanonicalOwner,
  resolveCanonicalCommunityMemberRole,
  resolveCommunityCanonicalOwnerUid,
} from './community-canonical-owner.policy';

test('resolve ownerUid canônico somente para identificador seguro', () => {
  assert.equal(
    resolveCommunityCanonicalOwnerUid({ ownerUid: ' owner-1 ' }),
    'owner-1'
  );
  assert.equal(
    resolveCommunityCanonicalOwnerUid({ ownerUid: 'owner/1' }),
    null
  );
  assert.equal(resolveCommunityCanonicalOwnerUid({}), null);
});

test('reconhece apenas o UID apontado pela autoridade canônica', () => {
  const community = { ownerUid: 'owner-1' };

  assert.equal(isCommunityCanonicalOwner(community, 'owner-1'), true);
  assert.equal(isCommunityCanonicalOwner(community, 'member-1'), false);
  assert.equal(isCommunityCanonicalOwner({}, 'owner-1'), false);
});

test('ownerUid prevalece sobre papel divergente do membership', () => {
  const community = { ownerUid: 'owner-1' };

  assert.equal(
    resolveCanonicalCommunityMemberRole(community, 'owner-1', 'member'),
    'owner'
  );
  assert.equal(
    resolveCanonicalCommunityMemberRole(community, 'owner-1', 'admin'),
    'owner'
  );
  assert.equal(
    resolveCanonicalCommunityMemberRole(community, 'member-1', 'moderator'),
    'moderator'
  );
});
