import { logger } from 'firebase-functions';
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { hashMediaMutationRequest } from './media-mutation-idempotency.policy';

const IDEMPOTENCY_COLLECTION = 'media_mutation_idempotency';
const OPERATION_LEASE_MS = 2 * 60 * 1000;
const SUCCESS_CACHE_MS = 15 * 1000;
const CLEANUP_BATCH_LIMIT = 450;

export type MediaMutationAction =
  | 'UPLOAD_REGISTER'
  | 'PHOTO_PUBLISH'
  | 'PHOTO_UNPUBLISH'
  | 'PHOTO_SET_COVER'
  | 'VIDEO_PUBLISH'
  | 'VIDEO_UNPUBLISH'
  | 'PHOTO_DELETE'
  | 'VIDEO_DELETE'
  | 'VIDEO_SETTINGS';

interface MediaMutationIdempotencyInput<T> {
  actorUid: string;
  action: MediaMutationAction;
  resourceKey: string;
  requestData: unknown;
  execute: () => Promise<T>;
}

interface IdempotencyDocument<T> {
  status?: 'RUNNING' | 'SUCCEEDED';
  leaseUntil?: number;
  expiresAt?: number;
  response?: T;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanResourceKey(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= 512 ? normalized : '';
}

function cloneResponse<T>(response: T): T {
  return JSON.parse(JSON.stringify(response)) as T;
}

export async function executeMediaMutationIdempotently<T>(
  input: MediaMutationIdempotencyInput<T>
): Promise<T> {
  const actorUid = cleanId(input.actorUid);
  const resourceKey = cleanResourceKey(input.resourceKey);

  if (!actorUid || !resourceKey) {
    throw new HttpsError(
      'invalid-argument',
      'Não foi possível identificar esta operação de mídia.'
    );
  }

  const requestHash = hashMediaMutationRequest(input.requestData);
  const documentId = hashMediaMutationRequest({
    actorUid,
    action: input.action,
    resourceKey,
    requestHash,
  });
  const documentRef = db
    .collection(IDEMPOTENCY_COLLECTION)
    .doc(documentId);
  const now = Date.now();
  const acquisition = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(documentRef);
    const existing = snapshot.exists
      ? snapshot.data() as IdempotencyDocument<T>
      : null;

    if (
      existing?.status === 'SUCCEEDED' &&
      Number(existing.expiresAt ?? 0) > now &&
      existing.response !== undefined
    ) {
      return {
        cached: true as const,
        response: existing.response,
      };
    }

    if (
      existing?.status === 'RUNNING' &&
      Number(existing.leaseUntil ?? 0) > now
    ) {
      throw new HttpsError(
        'aborted',
        'Esta ação já está sendo concluída.',
        {
          action: input.action,
          retryAfterMs: Math.max(
            1_000,
            Number(existing.leaseUntil ?? now) - now
          ),
        }
      );
    }

    transaction.set(documentRef, {
      actorUid,
      action: input.action,
      resourceHash: hashMediaMutationRequest(resourceKey),
      requestHash,
      status: 'RUNNING',
      leaseUntil: now + OPERATION_LEASE_MS,
      expiresAt: now + OPERATION_LEASE_MS,
      createdAt: snapshot.exists
        ? snapshot.get('createdAt') ?? now
        : now,
      updatedAt: now,
    });

    return { cached: false as const };
  });

  if (acquisition.cached) {
    return cloneResponse(acquisition.response);
  }

  try {
    const response = await input.execute();
    const safeResponse = cloneResponse(response);
    const completedAt = Date.now();

    await documentRef.set(
      {
        status: 'SUCCEEDED',
        response: safeResponse,
        leaseUntil: null,
        expiresAt: completedAt + SUCCESS_CACHE_MS,
        updatedAt: completedAt,
      },
      { merge: true }
    );

    return response;
  } catch (error) {
    try {
      await documentRef.delete();
    } catch (cleanupError) {
      logger.warn('[mediaMutationIdempotency] Falha ao liberar operação.', {
        action: input.action,
        error: cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError ?? ''),
      });
    }

    throw error;
  }
}

export const cleanupMediaMutationIdempotency = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    const snapshot = await db
      .collection(IDEMPOTENCY_COLLECTION)
      .where('expiresAt', '<=', Date.now())
      .limit(CLEANUP_BATCH_LIMIT)
      .get();

    if (snapshot.empty) {
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();

    logger.info('[cleanupMediaMutationIdempotency] Operações removidas.', {
      removed: snapshot.size,
    });
  }
);
