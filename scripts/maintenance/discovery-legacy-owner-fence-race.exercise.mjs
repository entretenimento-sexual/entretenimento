// Issue #236 — B2.5: synthetic-only Firestore transaction race exercise.
// Invoked by a temporary EMPTY demo Firestore Emulator runner only. Never
// a production writer, user-data migration, or Cloud Functions endpoint.
import {
  SYNTHETIC_PURGE_PROJECT, SYNTHETIC_PURGE_HOST,
} from './account-legacy-recovery-purge-emulator.policy.mjs';
import {
  assertRecoveryOwnerEligibleForTransactionalStaging,
} from './discovery-legacy-owner-fence.policy.mjs';
import {
  candidateFromPublicProfile,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';

function assertSandbox(db, env) {
  if (!db || env.FIRESTORE_EMULATOR_HOST !== SYNTHETIC_PURGE_HOST ||
      env.GCLOUD_PROJECT !== SYNTHETIC_PURGE_PROJECT ||
      env.GOOGLE_APPLICATION_CREDENTIALS || env.FUNCTIONS_EMULATOR ||
      env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('FENCE_RACE_DEMO_EMULATOR_REQUIRED');
  }
}

function must(condition, code) {
  if (!condition) throw new Error(code);
}

function refs(db, uid) {
  return {
    owner: db.collection('users').doc(uid),
    public: db.collection('public_profiles').doc(uid),
    recovery: db.collection('legacy_discovery_preference_recovery').doc(uid),
  };
}

async function seedActive(db, uid) {
  const ref = refs(db, uid);
  await ref.owner.create({
    accountStatus: 'active',
    publicVisibility: 'hidden',
    role: 'user',
  });
  await ref.public.create({
    identity: 'synthetic-only',
    interestedInGenders: ['synthetic-only'],
  });
  return ref;
}

async function stageSyntheticRecoveryTransaction(db, uid) {
  const ref = refs(db, uid);
  return db.runTransaction(async (tx) => {
    // Read the SAME owner document the deletion flow updates. Firestore
    // serializes these reads with competing transactional updates.
    const owner = await tx.get(ref.owner);
    const source = await tx.get(ref.public);
    const target = await tx.get(ref.recovery);
    must(owner.exists && source.exists, 'FENCE_SYNTHETIC_SOURCE_MISSING');
    // Check owner FIRST: a deleted account must be rejected even when the
    // quarantine document already exists from an earlier serial commit.
    assertRecoveryOwnerEligibleForTransactionalStaging(owner.data());
    must(!target.exists, 'FENCE_SYNTHETIC_TARGET_EXISTS');
    const candidate = candidateFromPublicProfile(uid, source.data());
    must(candidate, 'FENCE_SYNTHETIC_CANDIDATE_MISSING');
    tx.create(ref.recovery, candidate);
    return { created: 1 };
  }, { maxAttempts: 5 });
}

async function setPendingDeletion(db, ownerRef, now) {
  await db.runTransaction(async (tx) => {
    const before = await tx.get(ownerRef);
    must(before.exists, 'FENCE_SYNTHETIC_OWNER_MISSING');
    tx.update(ownerRef, {
      accountStatus: 'pending_deletion',
      deletionRequestedAt: now,
    });
  });
}

async function setDeletedWithLease(db, ownerRef, now) {
  await db.runTransaction(async (tx) => {
    const before = await tx.get(ownerRef);
    must(before.exists, 'FENCE_SYNTHETIC_OWNER_MISSING');
    tx.update(ownerRef, {
      accountStatus: 'deleted',
      deletionRequestedAt: now,
      purgeAfter: now,
      purgeLeaseOwner: 'synthetic-race-lease',
      purgeLeaseUntil: now + 600_000,
    });
  });
}

async function assertStagingRejected(db, uid) {
  let denied = false;
  try {
    await stageSyntheticRecoveryTransaction(db, uid);
  } catch (error) {
    denied = error?.message === 'RECOVERY_OWNER_DELETION_FENCE';
  }
  must(denied, 'FENCE_POST_DELETION_STAGING_NOT_REJECTED');
}

/**
 * Two legal serial orders for write-vs-deletion-intent:
 * - Copy commits first; later deletion (same owner doc) observes the state,
 *   and the existing lifecycle cleanup removes the private record.
 * - Deletion intent commits first; retry/re-read of owner rejects staging.
 *
 * Do not pause an Admin SDK transaction after reading a document: Firestore
 * may lock that document until commit, causing an artificial deadlock. The
 * concurrent transactions below run without internal awaits/barriers.
 */
export async function exerciseSyntheticOwnerFenceRaces(
  db, accountDeletionAdapter, env = process.env
) {
  assertSandbox(db, env);
  const now = Date.now();
  const racingOwner = 'synthetic-fence-racing-owner';
  const writeFirstOwner = 'synthetic-fence-write-first-owner';
  const racing = await seedActive(db, racingOwner);

  // Record a stale, permissive preflight snapshot OUTSIDE the transaction.
  // A real writer must never trust this earlier observation to authorize
  // writes after the account enters the deletion lifecycle.
  const stalePreflight = await racing.owner.get();
  must(stalePreflight.exists, 'FENCE_SYNTHETIC_OWNER_MISSING');
  assertRecoveryOwnerEligibleForTransactionalStaging(stalePreflight.data());

  const [write, deletion] = await Promise.allSettled([
    stageSyntheticRecoveryTransaction(db, racingOwner),
    setPendingDeletion(db, racing.owner, now),
  ]);
  must(deletion.status === 'fulfilled', 'FENCE_DELETION_INTENT_FAILED');
  if (write.status === 'rejected') {
    must(write.reason?.message === 'RECOVERY_OWNER_DELETION_FENCE',
      'FENCE_WRITER_FAILED_FOR_UNRELATED_REASON');
  } else {
    must(write.value?.created === 1,
      'FENCE_WRITER_REPORTED_INVALID_COMMIT');
  }

  // The owner must be pending-deletion when BOTH transactions have settled.
  const pending = await racing.owner.get();
  must(pending.get('accountStatus') === 'pending_deletion',
    'FENCE_DELETION_INTENT_LOST');
  const concurrentRecovery = await racing.recovery.get();
  if (write.status === 'fulfilled') {
    // If the writer won, its commit must be no later than the transition.
    // Firestore server timestamps are used solely inside this demo test.
    must(concurrentRecovery.exists && concurrentRecovery.createTime &&
      pending.updateTime, 'FENCE_CONCURRENT_COMMIT_NOT_VISIBLE');
    const created = concurrentRecovery.createTime;
    const transitioned = pending.updateTime;
    must(created.seconds < transitioned.seconds ||
      (created.seconds === transitioned.seconds &&
        created.nanoseconds <= transitioned.nanoseconds),
    'FENCE_WRITE_COMMITTED_AFTER_DELETION_INTENT');
  } else {
    must(!concurrentRecovery.exists, 'FENCE_REJECTED_WRITER_LEFT_DOCUMENT');
  }
  await assertStagingRejected(db, racingOwner);

  // A committed early copy is legitimate in serial order, but MUST be
  // removed by lifecycle purge after the account is marked deleted.
  await setDeletedWithLease(db, racing.owner, now);
  await accountDeletionAdapter.deletePreferences(racingOwner);
  must(!(await racing.recovery.get()).exists &&
    (await racing.recovery.listCollections()).length === 0,
  'FENCE_RACE_RECOVERY_RESIDUE');
  await assertStagingRejected(db, racingOwner);

  // Deterministically verify the other serial order: copy first, THEN
  // account transition and purge, then attempt to recreate.
  const first = await seedActive(db, writeFirstOwner);
  const copied = await stageSyntheticRecoveryTransaction(db, writeFirstOwner);
  must(copied.created === 1 &&
    (await first.recovery.get()).exists,
  'FENCE_COPY_FIRST_NOT_COMMITTED');
  await setDeletedWithLease(db, first.owner, now);
  const removed = await accountDeletionAdapter.deletePreferences(writeFirstOwner);
  must(removed === 1 &&
    !(await first.recovery.get()).exists &&
    (await first.recovery.listCollections()).length === 0,
  'FENCE_COPY_FIRST_NOT_PURGED');
  await assertStagingRejected(db, writeFirstOwner);

  return Object.freeze({
    staleWriteAfterDeletionRejected: true,
    writerBeforeDeletionPurged: true,
    recreationAfterPurgeRejected: true,
    raceOwners: 2,
    concurrentWritePurgedOrDenied: true,
  });
}
