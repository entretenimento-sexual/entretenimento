// Account deletion integration for private legacy discovery recovery (#236).
// Called ONLY by the pre-finalize 'preferences' purge domain. The actual
// Firestore adapter is responsible for the recursive removal and verification.
// No Admin SDK/Cloud Function/credential imports in this testable policy.
export interface LegacyRecoveryOwnerState {
  exists: boolean;
  accountStatus: unknown;
  purgeLeaseOwner: unknown;
  purgeLeaseUntil: unknown;
}

export interface LegacyRecoveryDocumentState {
  exists: boolean;
  ownerUid: unknown;
}

export interface LegacyRecoveryPurgePort {
  getOwner(uid: string): Promise<LegacyRecoveryOwnerState>;
  getRecovery(uid: string): Promise<LegacyRecoveryDocumentState>;
  deleteRecoveryTree(uid: string): Promise<void>;
  recoveryTreeExists(uid: string): Promise<boolean>;
}

function reject(code: string): never {
  const error = new Error('Account legacy recovery purge blocked.');
  Object.assign(error, { code });
  throw error;
}

function assertUid(uid: string): void {
  if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128 ||
      uid === '.' || uid === '..' || uid.includes('/') || uid.includes('\\')) {
    reject('purge/legacy-recovery-invalid-owner');
  }
}

function assertActiveDeletionLease(
  owner: LegacyRecoveryOwnerState, nowMs: number
): void {
  if (!owner.exists || owner.accountStatus !== 'deleted' ||
      typeof owner.purgeLeaseOwner !== 'string' ||
      owner.purgeLeaseOwner.trim().length === 0 ||
      !Number.isSafeInteger(owner.purgeLeaseUntil) ||
      Number(owner.purgeLeaseUntil) <= nowMs) {
    reject('purge/legacy-recovery-deletion-lease-required');
  }
}

/**
 * Idempotently purge private legacy discovery recovery before account finalization.
 * May remove a parent document AND descendants even when the parent is absent.
 *
 * This does not authorize any persistence/recovery writer. It runs only under
 * an existing account deletion lease and must complete before the preferences
 * domain can be marked 'completed'. Any failure blocks account finalization.
 */
export async function purgeLegacyDiscoveryRecoveryOnAccountDeletion(
  port: LegacyRecoveryPurgePort,
  uid: string,
  nowMs: number
): Promise<number> {
  assertUid(uid);
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    reject('purge/legacy-recovery-invalid-clock');
  }

  const [owner, recovery] = await Promise.all([
    port.getOwner(uid), port.getRecovery(uid),
  ]);
  assertActiveDeletionLease(owner, nowMs);

  if (recovery.exists && recovery.ownerUid !== uid) {
    reject('purge/legacy-recovery-owner-mismatch');
  }

  // Revalidate the account deletion lease immediately before deletion.
  // A future writer must also refuse creation for deleted/purging accounts;
  // this policy alone is not a transactional fence against concurrent writers.
  assertActiveDeletionLease(await port.getOwner(uid), nowMs);

  await port.deleteRecoveryTree(uid);
  if (await port.recoveryTreeExists(uid)) {
    reject('purge/legacy-recovery-not-empty');
  }

  return recovery.exists ? 1 : 0;
}
