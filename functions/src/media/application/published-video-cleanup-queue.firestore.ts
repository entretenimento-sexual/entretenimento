import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import {
  canClaimVideoCleanupJob,
  VIDEO_CLEANUP_LEASE_MS,
} from './video-cleanup-claim.policy';
import { MEDIA_CLEANUP_MAX_ATTEMPTS } from './media-cleanup-retry.policy';
import { nextVideoCleanupRetry } from './video-cleanup-job.policy';

export type PublishedCleanupCompletion =
  | 'STALE'
  | 'REMOVED'
  | 'RETRYABLE'
  | 'DEAD_LETTER';

/** The returned data is from the same transaction that acquired the lease. */
export async function claimPublishedVideoCleanupJob<T>(
  firestore: Firestore,
  ref: DocumentReference,
  now: number,
  token: string
): Promise<T | null> {
  if (!token || !Number.isFinite(now)) {
    throw new Error('Invalid published cleanup lease arguments.');
  }

  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data || !canClaimVideoCleanupJob(data, now)) return null;

    const leaseUntil = now + VIDEO_CLEANUP_LEASE_MS;
    transaction.set(ref, {
      leaseToken: token,
      leaseUntil,
      nextAttemptAt: leaseUntil,
      updatedAt: now,
    }, { merge: true });
    return data as T;
  });
}

/** Only the current lease holder may acknowledge or reschedule a job. */
export async function settlePublishedVideoCleanupJob(
  firestore: Firestore,
  ref: DocumentReference,
  token: string,
  errorMessage: string | null,
  now = Date.now(),
  manualReview = false
): Promise<PublishedCleanupCompletion> {
  if (!token || !Number.isFinite(now)) {
    throw new Error('Invalid published cleanup completion arguments.');
  }

  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (!data || data['leaseToken'] !== token) return 'STALE';

    if (errorMessage === null) {
      transaction.delete(ref);
      return 'REMOVED';
    }

    const retry = nextVideoCleanupRetry(data['attempts'], now);
    transaction.set(ref, {
      state: manualReview ? 'dead_letter' : retry.state,
      attempts: manualReview ? MEDIA_CLEANUP_MAX_ATTEMPTS : retry.attempts,
      nextAttemptAt: manualReview ? null : retry.nextAttemptAt,
      deadLetterExpiresAt: manualReview ? null : retry.deadLetterExpiresAt,
      updatedAt: now,
      lastError: errorMessage.slice(0, 500),
      leaseToken: null,
      leaseUntil: null,
    }, { merge: true });
    return manualReview || retry.state === 'dead_letter'
      ? 'DEAD_LETTER' : 'RETRYABLE';
  });
}

/**
 * A successful direct Storage delete must not discard a job already leased
 * to another scheduler. The scheduler will complete its idempotent retry.
 */
export async function clearPublishedVideoCleanupJobIfUnleased(
  firestore: Firestore,
  ref: DocumentReference,
  now = Date.now()
): Promise<'REMOVED' | 'LEASED' | 'MISSING'> {
  if (!Number.isFinite(now)) {
    throw new Error('Invalid published cleanup time.');
  }

  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return 'MISSING';
    const data = snap.data() ?? {};
    const leaseToken = data['leaseToken'];
    const leaseUntil = data['leaseUntil'];
    if (
      (typeof leaseToken === 'string' && leaseToken.length > 0)
      || (typeof leaseUntil === 'number' && leaseUntil > now)
    ) {
      return 'LEASED';
    }

    transaction.delete(ref);
    return 'REMOVED';
  });
}
