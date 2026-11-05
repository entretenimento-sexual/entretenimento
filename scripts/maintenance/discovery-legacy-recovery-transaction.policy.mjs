// Issue #236 — B2: isolated-only, reversible Firestore transaction contract.
// This module DOES NOT start a runner or connect to Firebase by itself.
// Every entry point refuses production, the primary emulator and credentials.
// The caller must use an isolated, ephemeral Firestore Emulator import only.
import {
  ISOLATED_FIRESTORE, PROJECT_ID, TARGET_COLLECTION,
  candidateFromPublicProfile, assessExistingRecovery,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';
import { assertIsolatedRecoveryOwnerNotDeleting } from './discovery-legacy-owner-fence.policy.mjs';

export const MAX_TRANSACTION_CANDIDATES = 10;
const ALLOWED_KEYS = new Set([
  'schemaVersion', 'ownerUid', 'sourceCollection', 'lifecycle',
  'visibilityConsentConfirmed', 'legacyRaw', 'contentSha256',
]);

export function assertIsolatedRecoveryContext(env) {
  if (env.FIRESTORE_EMULATOR_HOST !== ISOLATED_FIRESTORE) {
    throw new Error('ISOLATED_EMULATOR_REQUIRED');
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('CREDENTIALS_NOT_ALLOWED');
  }
  for (const key of [
    'FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GCP_PROJECT',
    'GOOGLE_CLOUD_PROJECT',
  ]) {
    if (env[key] && env[key] !== PROJECT_ID) {
      throw new Error('PROJECT_MISMATCH');
    }
  }
}

export function verifyRecoveryCandidates(candidates) {
  if (!Array.isArray(candidates) ||
      candidates.length === 0 ||
      candidates.length > MAX_TRANSACTION_CANDIDATES) {
    throw new Error('INVALID_CANDIDATE_COUNT');
  }
  const owners = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' ||
        Array.isArray(candidate)) throw new Error('INVALID_CANDIDATE');

    if (Object.keys(candidate).some((key) => !ALLOWED_KEYS.has(key))) {
      throw new Error('UNEXPECTED_RECOVERY_FIELD');
    }
    const expected = candidateFromPublicProfile(
      candidate.ownerUid, candidate.legacyRaw
    );
    // A digest only covers the two supported legacy keys. Reject extra raw
    // properties explicitly so unreviewed information is never copied.
    const expectedRawKeys = Object.keys(expected?.legacyRaw ?? {});
    const candidateRawKeys = candidate.legacyRaw &&
      typeof candidate.legacyRaw === 'object' &&
      !Array.isArray(candidate.legacyRaw)
      ? Object.keys(candidate.legacyRaw)
      : [];
    if (candidateRawKeys.length !== expectedRawKeys.length ||
        candidateRawKeys.some((key) => !expectedRawKeys.includes(key))) {
      throw new Error('UNEXPECTED_LEGACY_RAW_FIELD');
    }
    if (!expected || expected.contentSha256 !== candidate.contentSha256 ||
        candidate.schemaVersion !== 1 ||
        candidate.sourceCollection !== 'public_profiles' ||
        candidate.lifecycle !== 'PENDING_REVIEW' ||
        candidate.visibilityConsentConfirmed !== false) {
      throw new Error('CANDIDATE_INTEGRITY_FAILURE');
    }
    if (owners.has(candidate.ownerUid)) throw new Error('DUPLICATE_OWNER');
    owners.add(candidate.ownerUid);
  }
  return candidates;
}

function refsFor(db, candidate) {
  return {
    source: db.doc(`public_profiles/${candidate.ownerUid}`),
    owner: db.doc(`users/${candidate.ownerUid}`),
    recovery: db.doc(`${TARGET_COLLECTION}/${candidate.ownerUid}`),
  };
}

function verifyOrigin(candidate, source, owner) {
  if (!source.exists || !owner.exists) {
    throw new Error('SOURCE_OR_OWNER_MISSING');
  }
  // The isolated historical rehearsal does not authorize persistence.
  // Even here, reject deleted/purging owners inside the same transaction.
  assertIsolatedRecoveryOwnerNotDeleting(owner.data());
  const currentCandidate = candidateFromPublicProfile(
    candidate.ownerUid, source.data()
  );
  if (!currentCandidate ||
      currentCandidate.contentSha256 !== candidate.contentSha256) {
    throw new Error('SOURCE_CHANGED');
  }
}

export async function copyIntoIsolatedRecovery(db, candidates, env = process.env) {
  assertIsolatedRecoveryContext(env);
  verifyRecoveryCandidates(candidates);

  const items = candidates.map((candidate) => ({
    candidate, refs: refsFor(db, candidate),
  }));
  // One transaction. All document reads happen before any staged write.
  // On conflict, the entire transaction aborts; no partial copy.
  return db.runTransaction(async (tx) => {
    const reads = [];
    for (const { refs } of items) {
      reads.push({
        source: await tx.get(refs.source),
        owner: await tx.get(refs.owner),
        recovery: await tx.get(refs.recovery),
      });
    }
    const decisions = items.map(({ candidate }, index) => {
      const read = reads[index];
      verifyOrigin(candidate, read.source, read.owner);
      return assessExistingRecovery(
        candidate, read.recovery.exists ? read.recovery.data() : null
      );
    });

    const createdOwnerUids = [];
    for (let index = 0; index < items.length; index += 1) {
      if (decisions[index] !== 'WOULD_CREATE') continue;
      const { candidate, refs } = items[index];
      // Explicit allowlist; never copy other public profile properties.
      tx.create(refs.recovery, {
        schemaVersion: 1,
        ownerUid: candidate.ownerUid,
        sourceCollection: 'public_profiles',
        lifecycle: 'PENDING_REVIEW',
        visibilityConsentConfirmed: false,
        legacyRaw: structuredClone(candidate.legacyRaw),
        contentSha256: candidate.contentSha256,
      });
      createdOwnerUids.push(candidate.ownerUid);
    }
    return {
      createdOwnerUids, createdCount: createdOwnerUids.length,
      alreadyPreservedCount: decisions.length - createdOwnerUids.length,
    };
  });
}

export async function rollbackIsolatedRecovery(
  db, candidates, createdOwnerUids, env = process.env
) {
  assertIsolatedRecoveryContext(env);
  verifyRecoveryCandidates(candidates);
  if (!Array.isArray(createdOwnerUids) ||
      new Set(createdOwnerUids).size !== createdOwnerUids.length) {
    throw new Error('INVALID_ROLLBACK_SET');
  }
  const byOwner = new Map(candidates.map((item) => [item.ownerUid, item]));
  for (const uid of createdOwnerUids) {
    if (!byOwner.has(uid)) throw new Error('UNKNOWN_ROLLBACK_OWNER');
  }
  if (createdOwnerUids.length === 0) return { deletedCount: 0 };

  return db.runTransaction(async (tx) => {
    const selected = createdOwnerUids.map((uid) => {
      const candidate = byOwner.get(uid);
      return { candidate, refs: refsFor(db, candidate) };
    });
    const snapshots = [];
    for (const { refs } of selected) snapshots.push(await tx.get(refs.recovery));
    for (let i = 0; i < selected.length; i += 1) {
      if (!snapshots[i].exists || assessExistingRecovery(
        selected[i].candidate, snapshots[i].data()
      ) !== 'ALREADY_PRESERVED') {
        throw new Error('ROLLBACK_CONFLICT');
      }
    }
    // Delete only records created by THIS successful rehearsal invocation.
    // Pre-existing records, original public fields and active preferences stay untouched.
    for (const { refs } of selected) tx.delete(refs.recovery);
    return { deletedCount: selected.length };
  });
}

export async function verifyIsolationAfterRollback(
  db, candidates, createdOwnerUids, env = process.env
) {
  assertIsolatedRecoveryContext(env);
  verifyRecoveryCandidates(candidates);
  if (!Array.isArray(createdOwnerUids) ||
      new Set(createdOwnerUids).size !== createdOwnerUids.length ||
      createdOwnerUids.some((uid) =>
        !candidates.some((item) => item.ownerUid === uid))) {
    throw new Error('INVALID_VERIFICATION_SET');
  }
  const created = new Set(createdOwnerUids);
  for (const candidate of candidates) {
    const refs = refsFor(db, candidate);
    const [source, owner, recovery] = await db.getAll(
      refs.source, refs.owner, refs.recovery
    );
    verifyOrigin(candidate, source, owner);
    if (created.has(candidate.ownerUid)) {
      if (recovery.exists) throw new Error('ROLLBACK_NOT_EMPTY');
    } else {
      if (!recovery.exists) throw new Error('ORIGINAL_RECOVERY_MISSING');
      if (assessExistingRecovery(candidate, recovery.data()) !== 'ALREADY_PRESERVED') {
        throw new Error('ORIGINAL_RECOVERY_CHANGED');
      }
    }
  }
  return {
    verifiedOwnerCount: candidates.length,
    removedRecoveryCount: created.size,
    sourceDocumentsWritten: 0,
    activePreferencesWritten: 0,
  };
}

export async function exerciseIsolatedRecoveryRollback(
  db, candidates, env = process.env
) {
  assertIsolatedRecoveryContext(env);
  verifyRecoveryCandidates(candidates);
  const copied = await copyIntoIsolatedRecovery(db, candidates, env);
  try {
    // Validate the committed contents before attempting rollback.
    const refs = candidates.map((candidate) => refsFor(db, candidate).recovery);
    const snapshots = await db.getAll(...refs);
    for (let i = 0; i < candidates.length; i += 1) {
      if (!snapshots[i].exists ||
          assessExistingRecovery(candidates[i], snapshots[i].data()) !== 'ALREADY_PRESERVED') {
        throw new Error('POST_WRITE_INTEGRITY_FAILURE');
      }
    }
  } finally {
    // No success return is possible until cleanup and source validation pass.
    // If a concurrent actor changed a recovery record, fail closed instead
    // of blindly deleting it. An ephemeral caller must always stop its child
    // emulator even when this cleanup fails.
    await rollbackIsolatedRecovery(
      db, candidates, copied.createdOwnerUids, env
    );
    await verifyIsolationAfterRollback(
      db, candidates, copied.createdOwnerUids, env
    );
  }
  return {
    mode: 'ISOLATED_WRITE_ROLLBACK_TEST',
    candidates: candidates.length,
    created: copied.createdCount,
    alreadyPreserved: copied.alreadyPreservedCount,
    rolledBack: copied.createdCount,
    publicDocumentsWritten: 0,
    activePreferencesWritten: 0,
    sourceTimestampFidelityProven: false,
  };
}
