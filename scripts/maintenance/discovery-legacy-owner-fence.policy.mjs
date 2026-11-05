// Issue #236 — B2.5: PURE read-side owner fence for future recovery staging.
// No Firebase connection, UI, callable, migration, persistent writer or logs.
// Any future writer must read users/{uid} and recovery destination in the SAME
// Firestore transaction; checking account state only before a transaction is
// insufficient to prevent recreating quarantine during account deletion.

const DISQUALIFYING_STATUSES = new Set([
  'pending_deletion', 'deleted', 'suspended', 'banned', 'blocked',
  'pending_age_review', 'disabled',
]);
const DELETION_MARKERS = Object.freeze([
  'deletionRequestedAt', 'deletionRequestedBy', 'deletionUndoUntil',
  'deletedAt', 'purgeAfter', 'purgeStartedAt', 'purgePhase',
  'purgeLeaseOwner', 'purgeLeaseUntil', 'purgeNextAttemptAt',
  'purgeLastAttemptAt', 'purgeAttemptCount', 'purgeBlockedReason',
  'purgeBlockedDomains',
]);

export const RECOVERY_OWNER_FENCE_VERSION = 1;

function deny() {
  // No UID, state, source values or paths in errors; safe for aggregate logs.
  throw new Error('RECOVERY_OWNER_DELETION_FENCE');
}

function isMarkerSet(value) {
  if (value === undefined || value === null || value === false || value === '') {
    return false;
  }
  if (typeof value === 'number') return !Number.isFinite(value) || value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function assertNotDeleting(owner) {
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) deny();

  const status = owner.accountStatus;
  if (status !== undefined && status !== null &&
      (typeof status !== 'string' ||
        status !== 'active' || DISQUALIFYING_STATUSES.has(status))) {
    deny();
  }
  if (DELETION_MARKERS.some((key) => isMarkerSet(owner[key]))) deny();
  if (owner.interactionBlocked === true || owner.loginAllowed === false ||
      owner.legalHold === true || owner.billingHold === true) deny();
}

/**
 * B2.1-only historical snapshot reads: accept a legacy account without
 * accountStatus, but NEVER accept an explicit deletion status or markers.
 * This MUST NOT be used as authorization for a persistent writer.
 */
export function assertIsolatedRecoveryOwnerNotDeleting(owner) {
  assertNotDeleting(owner);
}

/**
 * Strict, irreversible future-writer prerequisite: an explicit active status,
 * no deletion intent or purge lease. Call only against the owner document
 * snapshot returned by tx.get() IN THE SAME TRANSACTION staging the write.
 * This predicate alone does not authorize backend/production persistence.
 */
export function assertRecoveryOwnerEligibleForTransactionalStaging(owner) {
  assertNotDeleting(owner);
  if (owner.accountStatus !== 'active') deny();
}
