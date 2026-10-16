import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import {
  canClaimVideoCleanupJob,
  VIDEO_CLEANUP_LEASE_MS,
} from './video-cleanup-claim.policy';
import { MEDIA_CLEANUP_MAX_ATTEMPTS } from './media-cleanup-retry.policy';
import { nextVideoCleanupRetry } from './video-cleanup-job.policy';

export type VideoDeletionJobCompletion =
  | 'STALE'
  | 'REMOVED'
  | 'RETRYABLE'
  | 'DEAD_LETTER';

export type VideoDeletionJobSettlement =
  | { kind: 'COMPLETED' }
  | { kind: 'RETRYABLE_FAILURE'; error: string }
  | { kind: 'BLOCKED'; error: string };

function validateLeaseArguments(now: number, token: string): void {
  if (!Number.isFinite(now) || typeof token !== 'string' || !token.trim()) {
    throw new Error('Invalid video deletion queue lease arguments.');
  }
}

/**
 * A duplicate delete request must never overwrite paths, attempts, a lease,
 * or a dead letter already persisted by an earlier request.
 */
export async function createVideoDeletionJobIfAbsent(
  firestore: Firestore,
  ref: DocumentReference,
  job: object,
  now: number
): Promise<'CREATED' | 'EXISTING'> {
  if (!Number.isFinite(now)) throw new Error('Invalid video deletion job time.');

  return firestore.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists) return 'EXISTING';

    tx.create(ref, {
      ...job,
      state: 'retryable',
      attempts: 0,
      nextAttemptAt: now,
      deadLetterExpiresAt: null,
      leaseToken: null,
      leaseUntil: null,
      createdAt: now,
      updatedAt: now,
    });
    return 'CREATED';
  });
}

/**
 * Lease acquisition is the transaction boundary for physical deletion.
 * Legacy documents without scheduling require migration, not implicit claim.
 */
export async function claimVideoDeletionJob<T>(
  firestore: Firestore,
  ref: DocumentReference,
  now: number,
  token: string
): Promise<T | null> {
  validateLeaseArguments(now, token);

  return firestore.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const data = current.exists ? current.data() : null;
    if (!data || !canClaimVideoCleanupJob(data, now)) return null;
    const attempts = data['attempts'];
    if (typeof attempts !== 'number' || !Number.isSafeInteger(attempts) ||
        attempts < 0 || attempts >= MEDIA_CLEANUP_MAX_ATTEMPTS) return null;

    const leaseUntil = now + VIDEO_CLEANUP_LEASE_MS;
    tx.set(ref, {
      leaseToken: token,
      leaseUntil,
      nextAttemptAt: leaseUntil,
      updatedAt: now,
    }, { merge: true });
    return data as T;
  });
}

/**
 * Fences completion and failure reporting to the current token. A blocked
 * object is retained indefinitely for explicit review (never auto-deleted).
 */
export async function settleVideoDeletionJob(
  firestore: Firestore,
  ref: DocumentReference,
  token: string,
  settlement: VideoDeletionJobSettlement,
  now = Date.now()
): Promise<VideoDeletionJobCompletion> {
  validateLeaseArguments(now, token);

  return firestore.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const data = current.exists ? current.data() : null;
    if (!data || data['leaseToken'] !== token) return 'STALE';

    if (settlement.kind === 'COMPLETED') {
      tx.delete(ref);
      return 'REMOVED';
    }

    if (settlement.kind === 'BLOCKED') {
      tx.set(ref, {
        state: 'dead_letter',
        nextAttemptAt: null,
        deadLetterExpiresAt: null,
        lastError: settlement.error.slice(0, 500),
        leaseToken: null,
        leaseUntil: null,
        updatedAt: now,
      }, { merge: true });
      return 'DEAD_LETTER';
    }

    const retry = nextVideoCleanupRetry(data['attempts'], now);
    tx.set(ref, {
      state: retry.state,
      attempts: retry.attempts,
      nextAttemptAt: retry.nextAttemptAt,
      deadLetterExpiresAt: retry.deadLetterExpiresAt,
      lastError: settlement.error.slice(0, 500),
      leaseToken: null,
      leaseUntil: null,
      updatedAt: now,
    }, { merge: true });
    return retry.state === 'dead_letter' ? 'DEAD_LETTER' : 'RETRYABLE';
  });
}
