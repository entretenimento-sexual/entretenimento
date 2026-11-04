import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TRANSACTION_CANDIDATES, assertIsolatedRecoveryContext,
  verifyRecoveryCandidates, copyIntoIsolatedRecovery,
  rollbackIsolatedRecovery, verifyIsolationAfterRollback,
  exerciseIsolatedRecoveryRollback,
} from '../maintenance/discovery-legacy-recovery-transaction.policy.mjs';
import {
  candidateFromPublicProfile, TARGET_COLLECTION,
} from '../maintenance/discovery-legacy-recovery-rehearsal.policy.mjs';

const safeEnv = Object.freeze({
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
  FIREBASE_PROJECT_ID: 'entretenimento-sexual',
});
const deepCopy = (value) => structuredClone(value);

function fakeDb(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, deepCopy(v)]));
  const history = [];
  const documentSnapshot = (ref) => ({
    exists: data.has(ref.path),
    data: () => data.has(ref.path) ? deepCopy(data.get(ref.path)) : undefined,
  });
  return {
    data, history,
    doc: (path) => ({ path }),
    getAll: async (...refs) => refs.map(documentSnapshot),
    runTransaction: async (callback) => {
      const actions = [];
      const tx = {
        get: async (ref) => documentSnapshot(ref),
        create: (ref, value) => actions.push({
          operation: 'create', path: ref.path, value: deepCopy(value),
        }),
        delete: (ref) => actions.push({ operation: 'delete', path: ref.path }),
      };
      const result = await callback(tx);
      // The simulated Firestore transaction applies actions only after
      // the callback succeeds; a thrown error cannot cause partial writes.
      for (const action of actions) {
        if (action.operation === 'create' && data.has(action.path)) {
          throw new Error('SIMULATED_TRANSACTION_CONFLICT');
        }
      }
      for (const action of actions) {
        if (action.operation === 'create') data.set(action.path, action.value);
        if (action.operation === 'delete') data.delete(action.path);
      }
      history.push(actions.map(({ operation, path }) => ({ operation, path })));
      return result;
    },
  };
}

function fixture() {
  const a = {
    interestedInGenders: [' A ', 'A', 'b'],
    interestedInOrientations: [],
    nickname: 'Private example A',
  };
  const b = {
    interestedInGenders: ['c', 'd'],
    interestedInOrientations: ['x', 'Y', 'z'],
    nickname: 'Private example B',
  };
  const db = fakeDb({
    'public_profiles/owner-a': a,
    'public_profiles/owner-b': b,
    'users/owner-a': { role: 'free', status: 'active' },
    'users/owner-b': { role: 'free', status: 'active' },
    'users/owner-a/preferences/profile': { preexisting: true },
    'users/owner-b/preferences/profile': { preexisting: true },
  });
  const candidates = [
    candidateFromPublicProfile('owner-a', a),
    candidateFromPublicProfile('owner-b', b),
  ];
  return { db, candidates };
}

function recoveryPath(uid) {
  return `${TARGET_COLLECTION}/${uid}`;
}

test('allows only isolated Firestore Emulator, without credentials', () => {
  assert.doesNotThrow(() => assertIsolatedRecoveryContext(safeEnv));
  for (const host of [
    undefined, '127.0.0.1:8080', 'localhost:28080', 'firestore.googleapis.com:443',
  ]) {
    assert.throws(() => assertIsolatedRecoveryContext({
      ...safeEnv, FIRESTORE_EMULATOR_HOST: host,
    }), /ISOLATED_EMULATOR_REQUIRED/);
  }
  assert.throws(() => assertIsolatedRecoveryContext({
    ...safeEnv, GOOGLE_APPLICATION_CREDENTIALS: '/private/credentials.json',
  }), /CREDENTIALS_NOT_ALLOWED/);
  for (const key of [
    'GCLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT',
  ]) {
    assert.throws(() => assertIsolatedRecoveryContext({
      ...safeEnv, [key]: 'other-project',
    }), /PROJECT_MISMATCH/);
  }
});

test('refuses invalid candidates, duplicates, oversized batch or injected fields', () => {
  const { candidates } = fixture();
  assert.equal(verifyRecoveryCandidates(candidates).length, 2);
  assert.equal(MAX_TRANSACTION_CANDIDATES, 10);
  assert.throws(() => verifyRecoveryCandidates([]), /INVALID_CANDIDATE_COUNT/);
  assert.throws(() => verifyRecoveryCandidates(
    Array(11).fill(candidates[0])
  ), /INVALID_CANDIDATE_COUNT/);
  assert.throws(() => verifyRecoveryCandidates(
    [candidates[0], candidates[0]]
  ), /DUPLICATE_OWNER/);
  assert.throws(() => verifyRecoveryCandidates([
    { ...candidates[0], showSeekingPublicly: true },
  ]), /UNEXPECTED_RECOVERY_FIELD/);
  assert.throws(() => verifyRecoveryCandidates([
    { ...candidates[0], contentSha256: 'f'.repeat(64) },
  ]), /CANDIDATE_INTEGRITY_FAILURE/);
  assert.throws(() => verifyRecoveryCandidates([
    {
      ...candidates[0],
      legacyRaw: { ...candidates[0].legacyRaw, unauthorizedField: 'SECRET' },
    },
  ]), /UNEXPECTED_LEGACY_RAW_FIELD/);

  assert.throws(() => verifyRecoveryCandidates([
    { ...candidates[0], visibilityConsentConfirmed: true },
  ]), /CANDIDATE_INTEGRITY_FAILURE/);
});

test('copies only the legacy fields, never an active preference or public field', async () => {
  const { db, candidates } = fixture();
  const beforePublic = deepCopy(db.data.get('public_profiles/owner-a'));
  const beforeActive = deepCopy(db.data.get('users/owner-a/preferences/profile'));
  const result = await copyIntoIsolatedRecovery(db, candidates, safeEnv);
  assert.equal(result.createdCount, 2);
  assert.equal(result.alreadyPreservedCount, 0);
  assert.deepEqual(db.data.get('public_profiles/owner-a'), beforePublic);
  assert.deepEqual(db.data.get('users/owner-a/preferences/profile'), beforeActive);
  assert.deepEqual(db.data.get(recoveryPath('owner-a')), candidates[0]);
  assert.deepEqual(db.data.get(recoveryPath('owner-b')), candidates[1]);
  for (const write of db.history.flat()) {
    assert.equal(write.path.startsWith(TARGET_COLLECTION + '/'), true);
  }
  await rollbackIsolatedRecovery(db, candidates, result.createdOwnerUids, safeEnv);
  await verifyIsolationAfterRollback(db, candidates, result.createdOwnerUids, safeEnv);
  assert.equal(db.data.has(recoveryPath('owner-a')), false);
  assert.equal(db.data.has(recoveryPath('owner-b')), false);
});

test('second copy is idempotent and rollback touches only records created by first copy', async () => {
  const { db, candidates } = fixture();
  const first = await copyIntoIsolatedRecovery(db, candidates, safeEnv);
  const second = await copyIntoIsolatedRecovery(db, candidates, safeEnv);
  assert.equal(first.createdCount, 2);
  assert.equal(second.createdCount, 0);
  assert.equal(second.alreadyPreservedCount, 2);
  assert.deepEqual(second.createdOwnerUids, []);
  assert.deepEqual(await rollbackIsolatedRecovery(
    db, candidates, second.createdOwnerUids, safeEnv
  ), { deletedCount: 0 });
  assert.equal(db.data.has(recoveryPath('owner-a')), true);
  const result = await rollbackIsolatedRecovery(
    db, candidates, first.createdOwnerUids, safeEnv
  );
  assert.equal(result.deletedCount, 2);
  await verifyIsolationAfterRollback(db, candidates, first.createdOwnerUids, safeEnv);
});

test('preserves an already-existing record when rolling back newly created records', async () => {
  const { db, candidates } = fixture();
  db.data.set(recoveryPath('owner-a'), deepCopy(candidates[0]));
  const result = await copyIntoIsolatedRecovery(db, candidates, safeEnv);
  assert.equal(result.createdCount, 1);
  assert.deepEqual(result.createdOwnerUids, ['owner-b']);
  assert.equal(result.alreadyPreservedCount, 1);
  await rollbackIsolatedRecovery(db, candidates, result.createdOwnerUids, safeEnv);
  await verifyIsolationAfterRollback(db, candidates, result.createdOwnerUids, safeEnv);
  assert.deepEqual(db.data.get(recoveryPath('owner-a')), candidates[0]);
  assert.equal(db.data.has(recoveryPath('owner-b')), false);
});

test('one conflict aborts the entire transaction before any writes', async () => {
  const { db, candidates } = fixture();
  db.data.set(recoveryPath('owner-b'), {
    ...deepCopy(candidates[1]), visibilityConsentConfirmed: true,
  });
  await assert.rejects(
    copyIntoIsolatedRecovery(db, candidates, safeEnv),
    /RECOVERY_CONFLICT/
  );
  assert.equal(db.data.has(recoveryPath('owner-a')), false);
  assert.equal(db.history.length, 0);
});

test('source mutation, missing owner or unreviewed private keys blocks copying', async () => {
  for (const mutate of [
    (db) => db.data.delete('users/owner-b'),
    (db) => db.data.get('public_profiles/owner-a').interestedInGenders.push('new'),
    (db) => { db.data.get('public_profiles/owner-a').hardRules = {}; },
  ]) {
    const { db, candidates } = fixture();
    mutate(db);
    await assert.rejects(
      copyIntoIsolatedRecovery(db, candidates, safeEnv),
      /SOURCE_OR_OWNER_MISSING|SOURCE_CHANGED|UNREVIEWED_PRIVATE_FIELD/
    );
    assert.equal(db.data.has(recoveryPath('owner-a')), false);
    assert.equal(db.data.has(recoveryPath('owner-b')), false);
  }
});

test('rollback refuses unknown owners and tampered records without deletion', async () => {
  const { db, candidates } = fixture();
  const first = await copyIntoIsolatedRecovery(db, candidates, safeEnv);
  await assert.rejects(rollbackIsolatedRecovery(
    db, candidates, ['another-owner'], safeEnv
  ), /UNKNOWN_ROLLBACK_OWNER/);
  db.data.get(recoveryPath('owner-b')).legacyRaw.interestedInGenders[0] = 'tampered';
  await assert.rejects(
    rollbackIsolatedRecovery(db, candidates, first.createdOwnerUids, safeEnv),
    /RECOVERY_CONFLICT/
  );
  assert.equal(db.data.has(recoveryPath('owner-a')), true);
  assert.equal(db.data.has(recoveryPath('owner-b')), true);
});

test('verification detects incomplete rollback and missing preexisting records', async () => {
  const { db, candidates } = fixture();
  const first = await copyIntoIsolatedRecovery(db, candidates, safeEnv);
  await assert.rejects(
    verifyIsolationAfterRollback(db, candidates, first.createdOwnerUids, safeEnv),
    /ROLLBACK_NOT_EMPTY/
  );
  await rollbackIsolatedRecovery(db, candidates, first.createdOwnerUids, safeEnv);
  await verifyIsolationAfterRollback(db, candidates, first.createdOwnerUids, safeEnv);

  const { db: secondDb, candidates: otherCandidates } = fixture();
  secondDb.data.set(recoveryPath('owner-a'), deepCopy(otherCandidates[0]));
  await assert.rejects(
    verifyIsolationAfterRollback(secondDb, otherCandidates, [], safeEnv),
    /ORIGINAL_RECOVERY_MISSING|ORIGINAL_RECOVERY_CHANGED/
  );
});

test('rejects writes to the primary emulator even with valid synthetic fixtures', async () => {
  const { db, candidates } = fixture();
  await assert.rejects(
    copyIntoIsolatedRecovery(db, candidates, {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    }),
    /ISOLATED_EMULATOR_REQUIRED/
  );
  assert.equal(db.history.length, 0);
});

test('complete isolated exercise restores original state and reports aggregate only', async () => {
  const { db, candidates } = fixture();
  const original = deepCopy(Object.fromEntries(db.data));
  const result = await exerciseIsolatedRecoveryRollback(db, candidates, safeEnv);
  assert.deepEqual(Object.fromEntries(db.data), original);
  assert.deepEqual(result, {
    mode: 'ISOLATED_WRITE_ROLLBACK_TEST',
    candidates: 2, created: 2, alreadyPreserved: 0, rolledBack: 2,
    publicDocumentsWritten: 0,
    activePreferencesWritten: 0,
    sourceTimestampFidelityProven: false,
  });
  const publicResult = JSON.stringify(result);
  for (const secret of ['owner-a', 'owner-b', 'Private example']) {
    assert.equal(publicResult.includes(secret), false);
  }
  assert.deepEqual(
    db.history.map((set) => set.map((action) => action.operation)),
    [['create', 'create'], ['delete', 'delete']]
  );
});
