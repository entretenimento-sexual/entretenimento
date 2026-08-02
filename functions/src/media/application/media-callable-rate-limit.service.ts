import { createHash } from 'node:crypto';

import type { Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  buildMediaCallableRateDecision,
  resolveMediaCallableRateLimitRule,
  type MediaCallableRateAction,
  type MediaCallableRateState,
} from './media-callable-rate-limit.policy';

const RATE_LIMIT_COLLECTION = 'media_callable_rate_limits';
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_LIMIT = 450;

export interface MediaCallableRateLimitInput {
  readonly actorUid: string;
  readonly action: MediaCallableRateAction;
  readonly resourceKey: string;
  readonly now?: number;
}

function cleanActorUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanResourceKey(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= 512 ? normalized : '';
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rateLimitRef(
  scope: 'global' | 'resource',
  actorUid: string,
  action: MediaCallableRateAction,
  resourceKey: string
) {
  const identity = scope === 'global'
    ? `${scope}:${actorUid}:${action}`
    : `${scope}:${actorUid}:${action}:${resourceKey}`;

  return db.collection(RATE_LIMIT_COLLECTION).doc(hashKey(identity));
}

function readState(
  data: FirebaseFirestore.DocumentData | undefined
): Partial<MediaCallableRateState> {
  return {
    windowStartedAt: data?.windowStartedAt,
    count: data?.count,
    lastAcceptedAt: data?.lastAcceptedAt,
  };
}

function throwRateLimit(
  action: MediaCallableRateAction,
  retryAfterMs: number
): never {
  throw new HttpsError(
    'resource-exhausted',
    'Muitas ações foram realizadas em pouco tempo. Aguarde antes de tentar novamente.',
    {
      action,
      retryAfterMs: Math.max(1_000, Math.ceil(retryAfterMs)),
    }
  );
}

/**
 * Consome limites global e por recurso em uma transação Firestore.
 *
 * Casos de uso podem chamar esta função dentro da própria transação, depois
 * das demais leituras, ou utilizar `assertMediaCallableRateLimit` como barreira
 * prévia para proteger consultas e validações mais caras.
 */
export async function assertMediaCallableRateLimitInTransaction(
  transaction: Transaction,
  input: MediaCallableRateLimitInput
): Promise<void> {
  const actorUid = cleanActorUid(input.actorUid);
  const resourceKey = cleanResourceKey(input.resourceKey);

  if (!actorUid || !resourceKey) {
    throw new HttpsError(
      'invalid-argument',
      'Não foi possível validar o limite desta ação.'
    );
  }

  const requestedNow = Number(input.now);
  const now = Number.isFinite(requestedNow) && requestedNow > 0
    ? Math.floor(requestedNow)
    : Date.now();
  const rule = resolveMediaCallableRateLimitRule(input.action);
  const globalRef = rateLimitRef(
    'global',
    actorUid,
    input.action,
    resourceKey
  );
  const resourceRef = rateLimitRef(
    'resource',
    actorUid,
    input.action,
    resourceKey
  );
  const [globalSnapshot, resourceSnapshot] = await Promise.all([
    transaction.get(globalRef),
    transaction.get(resourceRef),
  ]);
  const globalDecision = buildMediaCallableRateDecision({
    now,
    state: readState(globalSnapshot.data()),
    maxPerWindow: rule.globalMaxPerWindow,
    windowMs: rule.windowMs,
    minIntervalMs: rule.minIntervalMs,
  });
  const resourceDecision = buildMediaCallableRateDecision({
    now,
    state: readState(resourceSnapshot.data()),
    maxPerWindow: rule.resourceMaxPerWindow,
    windowMs: rule.windowMs,
    minIntervalMs: rule.minIntervalMs,
  });

  if (!globalDecision.allowed || !resourceDecision.allowed) {
    throwRateLimit(
      input.action,
      Math.max(
        globalDecision.retryAfterMs,
        resourceDecision.retryAfterMs
      )
    );
  }

  transaction.set(globalRef, {
    scope: 'global',
    actorUid,
    action: input.action,
    ...globalDecision.nextState,
    updatedAt: now,
  });
  transaction.set(resourceRef, {
    scope: 'resource',
    actorUid,
    action: input.action,
    resourceHash: hashKey(resourceKey),
    ...resourceDecision.nextState,
    updatedAt: now,
  });
}

export async function assertMediaCallableRateLimit(
  input: MediaCallableRateLimitInput
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    await assertMediaCallableRateLimitInTransaction(transaction, input);
  });
}

export const cleanupMediaCallableRateLimits = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    const cutoff = Date.now() - RATE_LIMIT_RETENTION_MS;
    const snapshot = await db
      .collection(RATE_LIMIT_COLLECTION)
      .where('updatedAt', '<=', cutoff)
      .limit(CLEANUP_BATCH_LIMIT)
      .get();

    if (snapshot.empty) {
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();

    logger.info('[cleanupMediaCallableRateLimits] Limites removidos.', {
      removed: snapshot.size,
    });
  }
);
