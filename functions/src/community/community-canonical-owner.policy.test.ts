// functions/src/community/community-canonical-owner.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCommunityCanonicalOwnerPointer,
  isCommunityCanonicalOwner,
  resolveCanonicalCommunityManagerRole,
  resolveCanonicalCommunityMemberRole,
  resolveCommunityCanonicalOwnerUid,
} from './community-canonical-owner.policy';

test('classifica ownerUid ausente, válido e corrompido sem ambiguidade', () => {
  assert.deepEqual(classifyCommunityCanonicalOwnerPointer({}), {
    kind: 'absent',
    uid: null,
  });
  assert.deepEqual(classifyCommunityCanonicalOwnerPointer({ ownerUid: '  ' }), {
    kind: 'absent',
    uid: null,
  });
  assert.deepEqual(
    classifyCommunityCanonicalOwnerPointer({ ownerUid: ' owner-1 ' }),
    { kind: 'valid', uid: 'owner-1' }
  );
  assert.deepEqual(
    classifyCommunityCanonicalOwnerPointer({ ownerUid: 'owner/1' }),
    { kind: 'invalid', uid: null }
  );
});

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

test('autoridade gerencial usa ownerUid e falha fechada para owner duplicado', () => {
  const community = { ownerUid: 'owner-1' };

  assert.equal(
    resolveCanonicalCommunityManagerRole(
      community,
      'owner-1',
      { status: 'active', role: 'member' }
    ),
    'owner'
  );
  assert.equal(
    resolveCanonicalCommunityManagerRole(
      community,
      'member-1',
      { status: 'active', role: 'owner' }
    ),
    null
  );
  assert.equal(
    resolveCanonicalCommunityManagerRole(
      community,
      'admin-1',
      { status: 'active', role: 'admin' }
    ),
    'admin'
  );
  assert.equal(
    resolveCanonicalCommunityManagerRole(
      community,
      'moderator-1',
      { status: 'active', role: 'moderator' }
    ),
    'moderator'
  );
  assert.equal(
    resolveCanonicalCommunityManagerRole(
      community,
      'member-1',
      { status: 'active', role: 'member' }
    ),
    null
  );
  assert.equal(
    resolveCanonicalCommunityManagerRole(
      community,
      'owner-1',
      { status: 'left', role: 'owner' }
    ),
    null
  );
});
