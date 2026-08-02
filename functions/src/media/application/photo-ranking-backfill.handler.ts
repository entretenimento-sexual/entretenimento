import { randomUUID } from 'node:crypto';

import { FieldPath } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { assertAdminAuthorization } from './admin-authorization.policy';
import {
  PHOTO_RANKING_BACKFILL_COLLECTION,
  PHOTO_RANKING_BACKFILL_ID,
  PHOTO_RANKING_BACKFILL_LEASE_MS,
  type PhotoRankingBackfillControlAction,
  type PhotoRankingBackfillPublicState,
  type PhotoRankingBackfillState,
  buildInitialPhotoRankingBackfillState,
  buildPhotoRankingBackfillPublicState,
  isPhotoRankingBackfillLeaseAvailable,
  nextPhotoRankingBackfillFailureStatus,
  normalizePhotoRankingBackfillAction,
  normalizePhotoRankingBackfillOperationId,
  normalizePhotoRankingBackfillPageSize,
  normalizePhotoRankingBackfillState,
  resolvePhotoRankingBackfillControlStatus,
  resolvePhotoRankingBackfillPostBatchStatus,
} from './photo-ranking-backfill.policy';
import {
  buildPhotoRankingUpdate,
  hasEquivalentPhotoRanking,
  isRankablePhoto,
  type PublicPhotoRankingDocument,
} from './photo-ranking-score';
import { normalizeMediaScore } from './media-engagement-score';

interface ControlPhotoRankingBackfillRequest {
  action?: PhotoRankingBackfillControlAction;
  operationId?: string;
  pageSize?: number;
}

interface InternalPhotoRankingBackfillBatchResult {
  acquired: boolean;
  completed: boolean;
  processed: number;
  updated: number;
  skipped: number;
  cursorPath: string | null;
  status: PhotoRankingBackfillState['status'];
}

interface PhotoRankingBackfillBatchResult {
  acquired: boolean;
  completed: boolean;
  processed: number;
  updated: number;
  skipped: number;
  status: PhotoRankingBackfillState['status'];
}

interface PhotoRankingBackfillStatusResponse {
  state: PhotoRankingBackfillPublicState;
  leaseActive: boolean;
  checkedAt: number;
}

interface ControlPhotoRankingBackfillResponse {
  action: PhotoRankingBackfillControlAction;
  alreadyApplied: boolean;
  state: PhotoRankingBackfillPublicState;
  batch: PhotoRankingBackfillBatchResult | null;
}

const ADMIN_PERMISSION_MESSAGE =
  'Apenas administradores podem controlar o backfill de ranking de fotos.';
const FAILURE_MESSAGE =
  'O lote de migração não foi concluído. A execução será retomada com segurança.';

function stateRef(): FirebaseFirestore.DocumentReference {
  return db
    .collection(PHOTO_RANKING_BACKFILL_COLLECTION)
    .doc(PHOTO_RANKING_BACKFILL_ID);
}

function stateForResponse(
  state: PhotoRankingBackfillState
): PhotoRankingBackfillPublicState {
  return buildPhotoRankingBackfillPublicState(state);
}

function batchForResponse(
  batch: InternalPhotoRankingBackfillBatchResult
): PhotoRankingBackfillBatchResult {
  return {
    acquired: batch.acquired,
    completed: batch.completed,
    processed: batch.processed,
    updated: batch.updated,
    skipped: batch.skipped,
    status: batch.status,
  };
}

async function readBackfillState(
  now = Date.now()
): Promise<PhotoRankingBackfillState> {
  const snapshot = await stateRef().get();

  return snapshot.exists
    ? normalizePhotoRankingBackfillState(snapshot.data(), now)
    : buildInitialPhotoRankingBackfillState({ now, status: 'IDLE' });
}

async function acquireBackfillLease(input: {
  runId: string;
  now: number;
  allowPaused: boolean;
}): Promise<PhotoRankingBackfillState | null> {
  const ref = stateRef();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const state = snapshot.exists
      ? normalizePhotoRankingBackfillState(snapshot.data(), input.now)
      : buildInitialPhotoRankingBackfillState({ now: input.now });

    if (
      state.status === 'COMPLETED' ||
      state.status === 'FAILED' ||
      (state.status === 'PAUSED' && !input.allowPaused)
    ) {
      return null;
    }

    if (
      !isPhotoRankingBackfillLeaseAvailable({
        state,
        now: input.now,
        runId: input.runId,
      })
    ) {
      return null;
    }

    const nextState: PhotoRankingBackfillState = {
      ...state,
      status: input.allowPaused && state.status === 'PAUSED'
        ? 'PAUSED'
        : 'RUNNING',
      startedAt: state.startedAt ?? input.now,
      leaseOwner: input.runId,
      leaseExpiresAt: input.now + PHOTO_RANKING_BACKFILL_LEASE_MS,
      updatedAt: input.now,
    };

    transaction.set(ref, nextState);
    return nextState;
  });
}

function buildPhotoQuery(
  cursorPath: string | null,
  pageSize: number
): FirebaseFirestore.Query {
  let query: FirebaseFirestore.Query = db
    .collectionGroup('public_photos')
    .orderBy(FieldPath.documentId())
    .limit(pageSize);

  if (cursorPath) {
    query = query.startAfter(cursorPath);
  }

  return query;
}

async function commitPhotoRankingPage(input: {
  documents: FirebaseFirestore.QueryDocumentSnapshot[];
  now: number;
}): Promise<{ updated: number; skipped: number }> {
  const batch = db.batch();
  const profileDeltas = new Map<string, number>();
  let updated = 0;
  let skipped = 0;

  for (const document of input.documents) {
    const data = document.data() as PublicPhotoRankingDocument;

    if (!isRankablePhoto(data)) {
      skipped += 1;
      continue;
    }

    const update = buildPhotoRankingUpdate(data, input.now);

    if (hasEquivalentPhotoRanking(data, update)) {
      skipped += 1;
      continue;
    }

    batch.set(document.ref, update, { merge: true });
    updated += 1;

    const ownerUid = document.ref.parent.parent?.id ?? '';
    const delta = update.viewScore - normalizeMediaScore(data.viewScore);

    if (ownerUid && delta !== 0) {
      profileDeltas.set(
        ownerUid,
        (profileDeltas.get(ownerUid) ?? 0) + delta
      );
    }
  }

  for (const [ownerUid, delta] of profileDeltas) {
    batch.set(
      db.doc(`public_profiles/${ownerUid}`),
      {
        viewScore: FieldValue.increment(delta),
        mediaMetricsUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  if (updated > 0) {
    await batch.commit();
  }

  return { updated, skipped };
}

async function finalizeBackfillBatch(input: {
  runId: string;
  now: number;
  processed: number;
  updated: number;
  skipped: number;
  cursorPath: string | null;
  completed: boolean;
}): Promise<PhotoRankingBackfillState> {
  const ref = stateRef();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const state = normalizePhotoRankingBackfillState(
      snapshot.data(),
      input.now
    );

    if (state.leaseOwner !== input.runId) {
      throw new HttpsError(
        'aborted',
        'O lease do backfill mudou antes da confirmação do lote.'
      );
    }

    const nextState: PhotoRankingBackfillState = {
      ...state,
      status: resolvePhotoRankingBackfillPostBatchStatus({
        currentStatus: state.status,
        completed: input.completed,
      }),
      cursorPath: input.cursorPath ?? state.cursorPath,
      processedCount: state.processedCount + input.processed,
      updatedCount: state.updatedCount + input.updated,
      skippedCount: state.skippedCount + input.skipped,
      pagesCount: state.pagesCount + 1,
      consecutiveFailures: 0,
      leaseOwner: null,
      leaseExpiresAt: 0,
      updatedAt: input.now,
      lastBatchAt: input.now,
      completedAt: input.completed ? input.now : null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };

    transaction.set(ref, nextState);
    return nextState;
  });
}

async function markBackfillBatchFailure(input: {
  runId: string;
  now: number;
}): Promise<void> {
  const ref = stateRef();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      return;
    }

    const state = normalizePhotoRankingBackfillState(
      snapshot.data(),
      input.now
    );

    if (state.leaseOwner !== input.runId) {
      return;
    }

    const consecutiveFailures = state.consecutiveFailures + 1;
    const status = state.status === 'PAUSED'
      ? 'PAUSED'
      : nextPhotoRankingBackfillFailureStatus(consecutiveFailures);

    transaction.set(ref, {
      ...state,
      status,
      consecutiveFailures,
      leaseOwner: null,
      leaseExpiresAt: 0,
      updatedAt: input.now,
      lastErrorCode: 'BACKFILL_BATCH_FAILED',
      lastErrorMessage: FAILURE_MESSAGE,
    });
  });
}

export async function executePhotoRankingBackfillBatch(
  options: { allowPaused?: boolean } = {}
): Promise<InternalPhotoRankingBackfillBatchResult> {
  const runId = randomUUID();
  const startedAt = Date.now();
  const leasedState = await acquireBackfillLease({
    runId,
    now: startedAt,
    allowPaused: options.allowPaused === true,
  });

  if (!leasedState) {
    const state = await readBackfillState(startedAt);
    return {
      acquired: false,
      completed: state.status === 'COMPLETED',
      processed: 0,
      updated: 0,
      skipped: 0,
      cursorPath: state.cursorPath,
      status: state.status,
    };
  }

  try {
    const snapshot = await buildPhotoQuery(
      leasedState.cursorPath,
      leasedState.pageSize
    ).get();
    const documents = snapshot.docs;
    const processed = documents.length;
    const cursorPath = documents.at(-1)?.ref.path ?? leasedState.cursorPath;
    const completed = documents.length < leasedState.pageSize;
    const result = await commitPhotoRankingPage({
      documents,
      now: startedAt,
    });
    const finalState = await finalizeBackfillBatch({
      runId,
      now: Date.now(),
      processed,
      updated: result.updated,
      skipped: result.skipped,
      cursorPath,
      completed,
    });

    logger.info('[photoRankingBackfill] Lote concluído.', {
      processed,
      updated: result.updated,
      skipped: result.skipped,
      completed,
      generation: finalState.generation,
      pagesCount: finalState.pagesCount,
    });

    return {
      acquired: true,
      completed,
      processed,
      updated: result.updated,
      skipped: result.skipped,
      cursorPath: finalState.cursorPath,
      status: finalState.status,
    };
  } catch (error) {
    await markBackfillBatchFailure({ runId, now: Date.now() });
    logger.error('[photoRankingBackfill] Falha ao executar lote.', {
      error: error instanceof Error ? error.message : String(error ?? ''),
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', FAILURE_MESSAGE);
  }
}

async function applyAdminControl(input: {
  adminUid: string;
  action: PhotoRankingBackfillControlAction;
  operationId: string;
  pageSize?: unknown;
}): Promise<{
  state: PhotoRankingBackfillState;
  alreadyApplied: boolean;
}> {
  const ref = stateRef();
  const adminLogRef = db.collection('admin_logs').doc();
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists
      ? normalizePhotoRankingBackfillState(snapshot.data(), now)
      : buildInitialPhotoRankingBackfillState({ now, status: 'IDLE' });

    if (current.lastAdminOperationId === input.operationId) {
      return { state: current, alreadyApplied: true };
    }

    if (
      input.action === 'RESET' &&
      !isPhotoRankingBackfillLeaseAvailable({
        state: current,
        now,
        runId: input.operationId,
      })
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Há um lote em execução. Aguarde o término antes de reiniciar.'
      );
    }

    if (current.status === 'COMPLETED' && input.action !== 'RESET') {
      throw new HttpsError(
        'failed-precondition',
        'O backfill já foi concluído. Use RESET para executá-lo novamente.'
      );
    }

    if (current.status === 'FAILED' && input.action === 'RUN_PAGE') {
      throw new HttpsError(
        'failed-precondition',
        'Retome a migração antes de executar um novo lote.'
      );
    }

    let nextState: PhotoRankingBackfillState;

    if (input.action === 'RESET') {
      nextState = {
        ...buildInitialPhotoRankingBackfillState({
          now,
          pageSize: input.pageSize ?? current.pageSize,
        }),
        generation: current.generation + 1,
      };
    } else {
      const pageSize = input.pageSize === undefined
        ? current.pageSize
        : normalizePhotoRankingBackfillPageSize(input.pageSize);

      nextState = {
        ...current,
        status: resolvePhotoRankingBackfillControlStatus({
          currentStatus: current.status,
          action: input.action,
        }),
        pageSize,
        startedAt: current.startedAt ?? now,
        completedAt: null,
        updatedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        consecutiveFailures: input.action === 'START_OR_RESUME'
          ? 0
          : current.consecutiveFailures,
      };
    }

    nextState.lastAdminOperationId = input.operationId;
    nextState.lastAdminAction = input.action;
    nextState.lastAdminBy = input.adminUid;

    transaction.set(ref, nextState);
    transaction.set(adminLogRef, {
      adminUid: input.adminUid,
      action: 'photoRankingBackfillControl',
      details: {
        operation: input.action,
        operationId: input.operationId,
        pageSize: nextState.pageSize,
        generation: nextState.generation,
        previousStatus: current.status,
        nextStatus: nextState.status,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return { state: nextState, alreadyApplied: false };
  });
}

export async function getPhotoRankingBackfillStatusCore(
  request: CallableRequest<Record<string, never>>
): Promise<PhotoRankingBackfillStatusResponse> {
  assertAdminAuthorization(request.auth, ADMIN_PERMISSION_MESSAGE);

  const checkedAt = Date.now();
  const state = await readBackfillState(checkedAt);

  return {
    state: stateForResponse(state),
    leaseActive: !!state.leaseOwner && state.leaseExpiresAt > checkedAt,
    checkedAt,
  };
}

export async function controlPhotoRankingBackfillCore(
  request: CallableRequest<ControlPhotoRankingBackfillRequest>
): Promise<ControlPhotoRankingBackfillResponse> {
  const adminUid = assertAdminAuthorization(
    request.auth,
    ADMIN_PERMISSION_MESSAGE
  );
  const action = normalizePhotoRankingBackfillAction(request.data?.action);
  const operationId = normalizePhotoRankingBackfillOperationId(
    request.data?.operationId
  );

  if (!action || !operationId) {
    throw new HttpsError(
      'invalid-argument',
      'Ação ou identificador da operação inválido.'
    );
  }

  const control = await applyAdminControl({
    adminUid,
    action,
    operationId,
    pageSize: request.data?.pageSize,
  });

  if (control.alreadyApplied || action !== 'RUN_PAGE') {
    return {
      action,
      alreadyApplied: control.alreadyApplied,
      state: stateForResponse(control.state),
      batch: null,
    };
  }

  const batch = await executePhotoRankingBackfillBatch({
    allowPaused: true,
  });
  const state = await readBackfillState();

  return {
    action,
    alreadyApplied: false,
    state: stateForResponse(state),
    batch: batchForResponse(batch),
  };
}

export const continuePhotoRankingBackfill = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    maxInstances: 1,
  },
  async () => {
    await executePhotoRankingBackfillBatch();
  }
);
