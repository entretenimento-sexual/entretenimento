import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_DATA_RETENTION_POLICY,
  buildAccountDataDeletionPlan,
  canFinalizePrivateUserDeletion,
  type AccountDataDomain,
} from './account-data-retention.policy';

test('full retention matrix becomes ready after every blocking domain completes', () => {
  const blockingDomains = ACCOUNT_DATA_RETENTION_POLICY
    .filter(
      (entry) =>
        entry.phase === 'pre_finalize' &&
        entry.blocksFinalization
    )
    .map((entry) => entry.domain as AccountDataDomain);

  assert.ok(blockingDomains.length > 0);
  assert.ok(
    ACCOUNT_DATA_RETENTION_POLICY
      .filter(
        (entry) =>
          entry.phase === 'pre_finalize' &&
          entry.blocksFinalization
      )
      .every((entry) => entry.automation === 'implemented')
  );

  const plan = buildAccountDataDeletionPlan({
    uid: 'full-retention-user',
    generatedAt: 1_800_000_000_000,
    completedDomains: blockingDomains,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.blockingDomains, []);
  assert.equal(canFinalizePrivateUserDeletion(plan), true);
  assert.ok(
    plan.steps.find((step) => step.domain === 'private_user_document')
  );
});
