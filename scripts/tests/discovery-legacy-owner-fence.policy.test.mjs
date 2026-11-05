import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  RECOVERY_OWNER_FENCE_VERSION,
  assertIsolatedRecoveryOwnerNotDeleting,
  assertRecoveryOwnerEligibleForTransactionalStaging,
} from '../maintenance/discovery-legacy-owner-fence.policy.mjs';
import {
  copyIntoIsolatedRecovery,
} from '../maintenance/discovery-legacy-recovery-transaction.policy.mjs';
import {
  candidateFromPublicProfile,
} from '../maintenance/discovery-legacy-recovery-rehearsal.policy.mjs';

const safeEnv = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
  FIREBASE_PROJECT_ID: 'entretenimento-sexual',
};
const invalidFields = [
  { accountStatus: 'pending_deletion' },
  { accountStatus: 'deleted' },
  { accountStatus: 'suspended' },
  { accountStatus: 'blocked' },
  { accountStatus: 'ACTIVE' },
  { accountStatus: false },
  { deletionRequestedAt: 1_800_000_000_000 },
  { deletionRequestedBy: 'test' },
  { deletionUndoUntil: 1_800_000_000_001 },
  { deletedAt: 1_800_000_000_000 },
  { purgeAfter: 1_800_000_000_000 },
  { purgeStartedAt: 1_800_000_000_000 },
  { purgePhase: 'claimed' },
  { purgeLeaseOwner: 'lease' },
  { purgeLeaseUntil: 1_800_000_060_000 },
  { purgeNextAttemptAt: 1_800_000_000_000 },
  { purgeLastAttemptAt: 1_800_000_000_000 },
  { purgeAttemptCount: 1 },
  { purgeBlockedReason: 'cleanup-in-progress' },
  { purgeBlockedDomains: ['preferences'] },
  { interactionBlocked: true },
  { loginAllowed: false },
  { legalHold: true },
  { billingHold: true },
];

test('future staging requires explicit active user with no lifecycle markers', () => {
  assert.equal(RECOVERY_OWNER_FENCE_VERSION, 1);
  assert.doesNotThrow(() => assertRecoveryOwnerEligibleForTransactionalStaging({
    accountStatus: 'active', role: 'user', publicVisibility: 'hidden',
    purgeAfter: null, purgeLeaseOwner: '', purgeAttemptCount: 0,
  }));
  for (const invalid of [null, undefined, [], {},
    { role: 'user' }, { accountStatus: null },
    ...invalidFields.map(v => ({ accountStatus: 'active', ...v }))]) {
    assert.throws(() => assertRecoveryOwnerEligibleForTransactionalStaging(invalid),
      /RECOVERY_OWNER_DELETION_FENCE/);
  }
});

test('isolated historical B2.1 accepts missing status but still denies deletion', () => {
  assert.doesNotThrow(() => assertIsolatedRecoveryOwnerNotDeleting({
    role: 'user',
  }));
  assert.doesNotThrow(() => assertIsolatedRecoveryOwnerNotDeleting({
    accountStatus: 'active',
  }));
  for (const invalid of invalidFields) {
    assert.throws(() => assertIsolatedRecoveryOwnerNotDeleting({
      accountStatus: 'active', ...invalid,
    }), /RECOVERY_OWNER_DELETION_FENCE/);
  }
});

function fakeDb(owner) {
  const profile = {
    interestedInGenders: ['Synthetic only'],
    interestedInOrientations: [],
  };
  const candidate = candidateFromPublicProfile('synthetic-owner', profile);
  const values = new Map([
    ['users/synthetic-owner', owner],
    ['public_profiles/synthetic-owner', profile],
  ]);
  const actions = [];
  return {
    candidate, values, actions,
    doc: (path) => ({ path }),
    runTransaction: async (fn) => {
      const staged = [];
      const tx = {
        get: async (ref) => ({
          exists: values.has(ref.path),
          data: () => values.get(ref.path),
        }),
        create: (ref, fields) => staged.push([ref.path, fields]),
      };
      const result = await fn(tx);
      for (const [path, fields] of staged) values.set(path, fields);
      actions.push(...staged);
      return result;
    },
  };
}

test('B2 rehearsal transaction rejects deleting owners before staging any write', async () => {
  for (const update of [
    { accountStatus: 'pending_deletion' },
    { accountStatus: 'deleted' },
    { accountStatus: 'active', purgeLeaseOwner: 'synthetic-lease' },
    { accountStatus: 'active', deletionRequestedAt: 1_800_000_000_000 },
    { accountStatus: 'active', interactionBlocked: true },
  ]) {
    const f = fakeDb(update);
    await assert.rejects(
      copyIntoIsolatedRecovery(f, [f.candidate], safeEnv),
      /RECOVERY_OWNER_DELETION_FENCE/
    );
    assert.deepEqual(f.actions, []);
    assert.equal(f.values.has('legacy_discovery_preference_recovery/synthetic-owner'), false);
  }
});

test('owner fence errors never contain owner IDs or sensitive values', () => {
  try {
    assertRecoveryOwnerEligibleForTransactionalStaging({
      accountStatus: 'deleted', ownerUid: 'private-synthetic-uid',
      secret: 'SENSITIVE',
    });
    assert.fail('Expected rejection');
  } catch (error) {
    assert.equal(String(error.message), 'RECOVERY_OWNER_DELETION_FENCE');
  }
});

test('real Firestore race harness fences a write inside the owner-reading transaction', () => {
  const filename = fileURLToPath(new URL(
    '../maintenance/discovery-legacy-owner-fence-race.exercise.mjs',
    import.meta.url
  ));
  const source = readFileSync(filename, 'utf8');
  assert.match(source, /db\.runTransaction\(async \(tx\) =>/);
  assert.match(source, /await tx\.get\(ref\.owner\)/);
  assert.match(source, /await tx\.get\(ref\.public\)/);
  assert.match(source, /await tx\.get\(ref\.recovery\)/);
  assert.match(source,
    /assertRecoveryOwnerEligibleForTransactionalStaging\(owner\.data\(\)\)/);
  assert.match(source, /tx\.create\(ref\.recovery, candidate\)/);
  assert.match(source, /accountStatus: 'pending_deletion'/);
  assert.match(source, /accountStatus: 'deleted'/);
  assert.match(source, /FENCE_DELETION_INTENT_LOST/);
  assert.match(source, /accountDeletionAdapter\.deletePreferences\(writeFirstOwner\)/);
});
