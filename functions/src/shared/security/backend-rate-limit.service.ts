import { createHash } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitConfig,
  type BackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';

export const BACKEND_RATE_LIMIT_COLLECTION = 'backend_rate_limits';
export const BACKEND_RATE_LIMIT_SCHEMA_VERSION = 1;

const MAX_LOCAL_BLOCK_CACHE_ENTRIES = 2_048;
const localBlockedUntilByRateLimitId = new Map<string, number>();

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
  const now = typeof suppliedNow === 'number' && Number.isFinite(suppliedNow)
    ? Math.floor(suppliedNow)
    : Date.now();

  if (!action || !subject) {
    throw new Error('Rate limit requer action e subject válidos.');
  }

  pruneLocalBlockCache(now);

  const rateLimitId = buildRateLimitDocumentId(action, subject);
  const localBlockedUntil = localBlockedUntilByRateLimitId.get(rateLimitId) ?? 0;

  if (localBlockedUntil > now) {
    throw rateLimitError(localBlockedUntil - now, message);
  }

  if (localBlockedUntil > 0) {
    localBlockedUntilByRateLimitId.delete(rateLimitId);
  }

  await db.runTransaction(async (transaction) => {
    try {
      await consumeBackendRateLimitQuotaInTransaction(transaction, {
        ...input, action, subject, message, now,
      });
    } catch (error) {
      if (error instanceof HttpsError && error.code === 'resource-exhausted') {
        const retryAfterMs = (error.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
        if (typeof retryAfterMs === 'number') {
          localBlockedUntilByRateLimitId.set(rateLimitId, now + retryAfterMs);
        }
      }
      throw error;
    }
  });
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
