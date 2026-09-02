import { createHash } from 'node:crypto';

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

  const rateLimitRef = db
    .collection(BACKEND_RATE_LIMIT_COLLECTION)
    .doc(rateLimitId);

  await db.runTransaction(async (transaction) => {
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
      localBlockedUntilByRateLimitId.set(
        rateLimitId,
        now + decision.retryAfterMs
      );
      throw rateLimitError(decision.retryAfterMs, message);
    }

    transaction.set(
      rateLimitRef,
      {
        schemaVersion: BACKEND_RATE_LIMIT_SCHEMA_VERSION,
        action,
        ...decision.nextState,
        updatedAt: now,
        expiresAt: new Date(now + input.config.sustainedWindowMs),
      },
      { merge: false }
    );
  });
}
