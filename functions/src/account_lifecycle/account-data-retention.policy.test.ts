import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_DATA_RETENTION_POLICY,
  ACCOUNT_DATA_RETENTION_POLICY_VERSION,
  buildAccountDataDeletionPlan,
  canFinalizePrivateUserDeletion,
  type AccountDataRetentionPolicyEntry,
} from './account-data-retention.policy';

test('policy covers shared content, moderation and financial domains safely', () => {
  const byDomain = new Map(
    ACCOUNT_DATA_RETENTION_POLICY.map((entry) => [entry.domain, entry])
  );

  assert.equal(byDomain.get('shared_messages')?.disposition, 'anonymize');
  assert.equal(byDomain.get('shared_publications')?.disposition, 'anonymize');
  assert.equal(
    byDomain.get('moderation_reports_and_evidence')?.disposition,
    'retain'
  );
  assert.equal(
    byDomain.get('financial_records_and_entitlements')?.disposition,
    'retain'
  );

  assert.notEqual(byDomain.get('shared_messages')?.disposition, 'delete');
  assert.notEqual(
    byDomain.get('moderation_reports_and_evidence')?.disposition,
    'delete'
  );
});

test('policy marks implemented private, temporary, membership and media executors', () => {
  const byDomain = new Map(
    ACCOUNT_DATA_RETENTION_POLICY.map((entry) => [entry.domain, entry])
  );

  assert.equal(byDomain.get('notifications')?.automation, 'implemented');
  assert.equal(byDomain.get('preferences')?.automation, 'implemented');
  assert.equal(
    byDomain.get('presence_and_location')?.automation,
    'implemented'
  );
  assert.equal(byDomain.get('friend_requests')?.automation, 'implemented');
  assert.equal(
    byDomain.get('community_memberships')?.automation,
    'implemented'
  );
  assert.equal(
    byDomain.get('room_participation')?.automation,
    'implemented'
  );
  assert.equal(byDomain.get('room_participation')?.disposition, 'unlink');
  assert.equal(
    byDomain.get('owned_media_and_storage')?.automation,
    'implemented'
  );
  assert.equal(
    byDomain.get('owned_media_and_storage')?.disposition,
    'delete'
  );
  assert.equal(
    byDomain.get('relationship_edges')?.automation,
    'contract_required'
  );
  assert.ok(ACCOUNT_DATA_RETENTION_POLICY_VERSION >= 6);
});

test('current plan remains blocked until every pre-finalize contract is completed', () => {
  const plan = buildAccountDataDeletionPlan({
    uid: 'user-1',
    generatedAt: 1_800_000_000_000,
    completedDomains: [
      'public_profile',
      'nickname_index',
      'auth_identity',
    ],
  });

  assert.equal(plan.policyVersion, ACCOUNT_DATA_RETENTION_POLICY_VERSION);
  assert.equal(plan.status, 'blocked');
  assert.equal(canFinalizePrivateUserDeletion(plan), false);
  assert.ok(plan.blockingDomains.includes('notifications'));
  assert.ok(plan.blockingDomains.includes('presence_and_location'));
  assert.ok(plan.blockingDomains.includes('community_memberships'));
  assert.ok(plan.blockingDomains.includes('room_participation'));
  assert.ok(plan.blockingDomains.includes('owned_media_and_storage'));
  assert.ok(plan.blockingDomains.includes('shared_messages'));
  assert.ok(
    plan.blockingDomains.includes('financial_records_and_entitlements')
  );
  assert.ok(!plan.blockingDomains.includes('private_user_document'));
});

test('completed domains are recorded and removed from blockers', () => {
  const plan = buildAccountDataDeletionPlan({
    uid: 'user-2',
    generatedAt: 1_800_000_000_000,
    completedDomains: [
      'public_profile',
      'nickname_index',
      'presence_and_location',
      'community_memberships',
      'room_participation',
      'owned_media_and_storage',
    ],
  });

  assert.deepEqual(plan.completedDomains, [
    'public_profile',
    'nickname_index',
    'presence_and_location',
    'community_memberships',
    'room_participation',
    'owned_media_and_storage',
  ]);
  assert.ok(!plan.blockingDomains.includes('public_profile'));
  assert.ok(!plan.blockingDomains.includes('nickname_index'));
  assert.ok(!plan.blockingDomains.includes('presence_and_location'));
  assert.ok(!plan.blockingDomains.includes('community_memberships'));
  assert.ok(!plan.blockingDomains.includes('room_participation'));
  assert.ok(!plan.blockingDomains.includes('owned_media_and_storage'));
  assert.ok(plan.blockingDomains.includes('auth_identity'));
});

test('finalization becomes ready only when all blocking pre-finalize steps are completed', () => {
  const compactPolicy: readonly AccountDataRetentionPolicyEntry[] = [
    {
      domain: 'public_profile',
      disposition: 'delete',
      phase: 'pre_finalize',
      automation: 'implemented',
      blocksFinalization: true,
      reason: 'test',
    },
    {
      domain: 'auth_identity',
      disposition: 'delete',
      phase: 'pre_finalize',
      automation: 'implemented',
      blocksFinalization: true,
      reason: 'test',
    },
    {
      domain: 'private_user_document',
      disposition: 'delete',
      phase: 'finalize',
      automation: 'implemented',
      blocksFinalization: false,
      reason: 'test',
    },
  ];

  const plan = buildAccountDataDeletionPlan({
    uid: 'user-3',
    generatedAt: 1_800_000_000_000,
    completedDomains: ['public_profile', 'auth_identity'],
    policy: compactPolicy,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.blockingDomains, []);
  assert.equal(canFinalizePrivateUserDeletion(plan), true);
});
