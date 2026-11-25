import { createHash } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import { BackendRateLimitQueue, BackendRateLimitQueueBusyError } from './backend-rate-limit-queue';
import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitConfig,
  type BackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';

export const BACKEND_RATE_LIMIT_COLLECTION = 'backend_rate_limits';
export const BACKEND_RATE_LIMIT_SCHEMA_VERSION = 1;

const MAX_LOCAL_BLOCK_CACHE_ENTRIES = 2_048;
const localBlockedUntilByRateLimitId = new Map<string, number>();
const standaloneQuotaQueue = new BackendRateLimitQueue();

function buildRateLimitDocumentId(action: string, subject: string): string {
  const digest = createHash('sha256')
    .update(`${action}:${subject}`)
    .digest('hex');

  return `backend-rate-limit__${digest}`;
}

function pruneLocalBlockCache(now: number): void {
  if (localBlockedUntilByRateLimitId.size <= MAX_LOCAL_BLOCK_CACHE_ENTRIES) {
    return;
  }

  for (const [rateLimitId, blockedUntil] of localBlockedUntilByRateLimitId) {
    if (blockedUntil <= now) {
      localBlockedUntilByRateLimitId.delete(rateLimitId);
    }
  }

  while (localBlockedUntilByRateLimitId.size > MAX_LOCAL_BLOCK_CACHE_ENTRIES) {
    const oldestKey = localBlockedUntilByRateLimitId.keys().next().value;
    if (!oldestKey) break;
    localBlockedUntilByRateLimitId.delete(oldestKey);
  }
}

function rateLimitError(
  retryAfterMs: number,
  message: string
): HttpsError {
  return new HttpsError(
    'resource-exhausted',
    message,
    { retryAfterMs: Math.max(1, Math.floor(retryAfterMs)) }
  );
}

export async function consumeBackendRateLimitQuota(input: {
  action: string;
  subject: string;
  cost?: number;
  config: BackendFixedWindowRateLimitConfig;
  message: string;
  now?: number;
}): Promise<void> {
  const action = String(input.action ?? '').trim();
  const subject = String(input.subject ?? '').trim();
  const message = String(input.message ?? '').trim()
    || 'Muitas solicitações foram feitas em pouco tempo.';
  const suppliedNow = input.now;
  const readNow = () => typeof suppliedNow === 'number' && Number.isFinite(suppliedNow)
    ? Math.floor(suppliedNow)
    : Date.now();

  if (!action || !subject) {
    throw new Error('Rate limit requer action e subject válidos.');
  }

  const rateLimitId = buildRateLimitDocumentId(action, subject);
  const assertNotLocallyBlocked = (now: number): void => {
    pruneLocalBlockCache(now);
    const blockedUntil = localBlockedUntilByRateLimitId.get(rateLimitId) ?? 0;
    if (blockedUntil > now) {
      throw rateLimitError(blockedUntil - now, message);
    }
    if (blockedUntil > 0) localBlockedUntilByRateLimitId.delete(rateLimitId);
  };

  // Existing denials can be served without creating a local queue.
  assertNotLocallyBlocked(readNow());

  try {
    await standaloneQuotaQueue.run(rateLimitId, async () => {
      // Recheck after waiting: an earlier transaction may have exhausted quota.
      const now = readNow();
      assertNotLocallyBlocked(now);

      try {
        await db.runTransaction((transaction) =>
          consumeBackendRateLimitQuotaInTransaction(transaction, {
            ...input, action, subject, message, now,
          })
        );
      } catch (error) {
        // Only an authoritative quota denial populates the negative cache.
        // Transient contention/transport failures must never grant a permit.
        if (error instanceof HttpsError && error.code === 'resource-exhausted') {
          const retryAfterMs = (error.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
          if (typeof retryAfterMs === 'number') {
            localBlockedUntilByRateLimitId.set(rateLimitId, now + retryAfterMs);
            pruneLocalBlockCache(now);
          }
        }
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof BackendRateLimitQueueBusyError) {
      throw new HttpsError('unavailable', 'Serviço temporariamente ocupado. Tente novamente.');
    }
    throw error;
  }
}

// For callers that must commit quota and domain effects atomically.
// Call after all other transaction reads and before any writes.
export async function consumeBackendRateLimitQuotaInTransaction(
  transaction: Transaction,
  input: {
    action: string;
    subject: string;
    cost?: number;
    config: BackendFixedWindowRateLimitConfig;
    message: string;
    now?: number;
  }
): Promise<void> {
  const action = String(input.action ?? '').trim();
  const subject = String(input.subject ?? '').trim();
  const message = String(input.message ?? '').trim() || 'Muitas solicitações foram feitas em pouco tempo.';
  const now = typeof input.now === 'number' && Number.isFinite(input.now)
    ? Math.floor(input.now) : Date.now();
  if (!action || !subject) throw new Error('Rate limit requer action e subject válidos.');
  const rateLimitId = buildRateLimitDocumentId(action, subject);
  const rateLimitRef = db
    .collection(BACKEND_RATE_LIMIT_COLLECTION)
    .doc(rateLimitId);

  const snapshot = await transaction.get(rateLimitRef);
  const state = snapshot.exists
    ? snapshot.data() as BackendFixedWindowRateLimitState
    : null;
  const decision = buildBackendFixedWindowRateLimitDecision({
    now,
    state,
    cost: input.cost ?? 1,
    config: input.config,
  });

  if (!decision.allowed) {
    throw rateLimitError(decision.retryAfterMs, message);
  }

  transaction.set(
    rateLimitRef,
    {
      schemaVersion: BACKEND_RATE_LIMIT_SCHEMA_VERSION,
      action,
      ...decision.nextState,
      updatedAt: now,
      expiresAt: new Date(
        Math.max(now, decision.nextState.sustainedWindowStartedAt) +
          input.config.sustainedWindowMs
      ),
    },
    { merge: false }
  );
}
