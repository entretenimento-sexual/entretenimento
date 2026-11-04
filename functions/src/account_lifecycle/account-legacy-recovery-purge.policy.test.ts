import assert from 'node:assert/strict';
import test from 'node:test';

import {
  purgeLegacyDiscoveryRecoveryOnAccountDeletion,
  type LegacyRecoveryPurgePort,
  type LegacyRecoveryOwnerState,
  type LegacyRecoveryDocumentState,
} from './account-legacy-recovery-purge.policy';

const OWNER = 'synthetic-owner';
const NOW = 1_800_000_000_000;

function fixture(options: {
  owner?: Partial<LegacyRecoveryOwnerState>;
  recovery?: Partial<LegacyRecoveryDocumentState>;
  descendants?: boolean;
  deleteFailure?: boolean;
  retainResidue?: boolean;
  revokeLeaseOnSecondRead?: boolean;
} = {}) {
  const owner: LegacyRecoveryOwnerState = {
    exists: true,
    accountStatus: 'deleted',
    purgeLeaseOwner: 'synthetic-purge-session',
    purgeLeaseUntil: NOW + 600_000,
    ...options.owner,
  };
  const recovery: LegacyRecoveryDocumentState = {
    exists: true,
    ownerUid: OWNER,
    ...options.recovery,
  };
  let descendants = options.descendants ?? true;
  const calls: string[] = [];
  let ownerReads = 0;

  const port: LegacyRecoveryPurgePort = {
    async getOwner(uid) {
      assert.equal(uid, OWNER);
      calls.push('readOwner');
      ownerReads += 1;
      return ownerReads > 1 && options.revokeLeaseOnSecondRead
        ? { ...owner, purgeLeaseOwner: null }
        : { ...owner };
    },
    async getRecovery(uid) {
      assert.equal(uid, OWNER);
      calls.push('readRecovery');
      return { ...recovery };
    },
    async deleteRecoveryTree(uid) {
      assert.equal(uid, OWNER);
      calls.push('deleteRecoveryTree');
      if (options.deleteFailure) throw new Error('simulated cleanup failure');
      if (!options.retainResidue) {
        recovery.exists = false;
        descendants = false;
      }
    },
    async recoveryTreeExists(uid) {
      assert.equal(uid, OWNER);
      calls.push('verifyRecoveryTree');
      return recovery.exists || descendants;
    },
  };
  return {
    port, calls,
    recoveryExists: () => recovery.exists,
    descendantsExist: () => descendants,
  };
}

test('deleted account lease removes private recovery doc and its descendants', async () => {
  const f = fixture();
  assert.equal(await purgeLegacyDiscoveryRecoveryOnAccountDeletion(
    f.port, OWNER, NOW
  ), 1);
  assert.equal(f.recoveryExists(), false);
  assert.equal(f.descendantsExist(), false);
  assert.deepEqual(f.calls, [
    'readOwner', 'readRecovery', 'readOwner',
    'deleteRecoveryTree', 'verifyRecoveryTree',
  ]);
});

test('idempotent even without a root recovery document but with descendants', async () => {
  const f = fixture({ recovery: { exists: false }, descendants: true });
  assert.equal(await purgeLegacyDiscoveryRecoveryOnAccountDeletion(
    f.port, OWNER, NOW
  ), 0);
  assert.equal(f.descendantsExist(), false);
  const again = fixture({ recovery: { exists: false }, descendants: false });
  assert.equal(await purgeLegacyDiscoveryRecoveryOnAccountDeletion(
    again.port, OWNER, NOW
  ), 0);
});

test('refuses purge for active, pending or missing accounts', async () => {
  for (const owner of [
    { exists: false }, { accountStatus: 'active' },
    { accountStatus: 'pending_deletion' },
    { accountStatus: 'suspended' },
    { purgeLeaseOwner: null }, { purgeLeaseOwner: '' },
    { purgeLeaseUntil: NOW }, { purgeLeaseUntil: NOW - 1 },
    { purgeLeaseUntil: 'untrusted-time' },
  ]) {
    const f = fixture({ owner });
    await assert.rejects(
      purgeLegacyDiscoveryRecoveryOnAccountDeletion(f.port, OWNER, NOW),
      (error: { code?: string }) =>
        error.code === 'purge/legacy-recovery-deletion-lease-required'
    );
    assert.equal(f.calls.includes('deleteRecoveryTree'), false);
    assert.equal(f.recoveryExists(), true);
  }
});

test('revalidates account deletion lease immediately before any delete', async () => {
  const f = fixture({ revokeLeaseOnSecondRead: true });
  await assert.rejects(
    purgeLegacyDiscoveryRecoveryOnAccountDeletion(f.port, OWNER, NOW),
    (error: { code?: string }) =>
      error.code === 'purge/legacy-recovery-deletion-lease-required'
  );
  assert.equal(f.calls.includes('deleteRecoveryTree'), false);
});

test('rejects mismatched recovery owner, preserving foreign data', async () => {
  const f = fixture({ recovery: { ownerUid: 'unrelated-owner' } });
  await assert.rejects(
    purgeLegacyDiscoveryRecoveryOnAccountDeletion(f.port, OWNER, NOW),
    (error: { code?: string }) =>
      error.code === 'purge/legacy-recovery-owner-mismatch'
  );
  assert.equal(f.recoveryExists(), true);
  assert.equal(f.calls.includes('deleteRecoveryTree'), false);
});

test('cannot report success if recursive deletion fails or leaves residue', async () => {
  for (const params of [
    { deleteFailure: true },
    { retainResidue: true },
  ]) {
    const f = fixture(params);
    await assert.rejects(
      purgeLegacyDiscoveryRecoveryOnAccountDeletion(f.port, OWNER, NOW)
    );
    assert.equal(f.recoveryExists(), true);
  }
});

test('rejects forged owner paths, invalid timestamps and no partial purge', async () => {
  for (const uid of [
    '', '.', '..', 'owner/other', 'owner\\other', 'x'.repeat(129),
  ]) {
    const f = fixture();
    await assert.rejects(
      purgeLegacyDiscoveryRecoveryOnAccountDeletion(f.port, uid, NOW),
      (error: { code?: string }) =>
        error.code === 'purge/legacy-recovery-invalid-owner'
    );
    assert.deepEqual(f.calls, []);
  }
  for (const nowMs of [0, -5, NaN, Infinity, 1.5]) {
    const f = fixture();
    await assert.rejects(
      purgeLegacyDiscoveryRecoveryOnAccountDeletion(f.port, OWNER, nowMs),
      (error: { code?: string }) =>
        error.code === 'purge/legacy-recovery-invalid-clock'
    );
    assert.deepEqual(f.calls, []);
  }
});
