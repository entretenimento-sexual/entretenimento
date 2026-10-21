import { randomUUID } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import {
  buildQueuedVideoProcessingJob,
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
  type VideoProcessingJobState,
} from './video-processing-job';
import { withAdminTriageProjection } from './admin-video-triage.firestore';
import { stageVideoTriageMutationInTransaction }
  from './admin-video-triage-mutation-outbox.firestore';
import {
  availableAdminVideoRecoveryActions,
  isUnconfirmedVideoSubmission,
  isUnsafeVideoProcessingRetry,
  isOverdueVideoCancellation,
  videoRecoveryRequiresProviderReview,
  type AdminVideoProcessingRecoveryAction,
} from './admin-video-processing-recovery.policy';
import { preserveTerminalCleanupBeforeRetry } from './video-terminal-temporary-cleanup.firestore';
import { isProviderPollReviewRequired } from './video-provider-poll-failure.policy';
import {
  compareAdminTriageJobs, VIDEO_TRIAGE_STALE_AFTER_MS,
} from './admin-video-global-triage.policy';
import {
  auditRecoveryQueuePage, type RecoveryQueuePageAudit,
} from './admin-video-queue-coverage.policy';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPrefix,
} from './video-storage-path';

interface ListRecoveryJobsRequest {
  limit?: number;
  cursor?: string | null;
}

interface RecoveryJobItem {
  jobId: string;
  ownerUid: string;
  videoId: string;
  processingVersion: string;
  state: VideoProcessingJobState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  ageMs: number;
  stale: boolean;
  timestampEvidence: 'UPDATED' | 'CREATED_FALLBACK' | 'UNVERIFIED';
  hasExternalJob: boolean;
  requiresProviderReview: boolean;
  requiresOperationalAttention: boolean;
  providerPollFailureCount: number;
  providerPollLastFailedAt: number | null;
  providerPollReviewRequired: boolean;
  unconfirmedSubmission: boolean;
  lastErrorCode: string | null;
  lastError: string | null;
  availableActions: AdminVideoProcessingRecoveryAction[];
}

interface ListRecoveryJobsResponse {
  items: RecoveryJobItem[];
  skippedItems: number;
  checkedAt: number;
  scanned: number;
  hasMore: boolean;
  nextCursor: string | null;
  orderScope: 'WITHIN_PAGE';
  audit: RecoveryQueuePageAudit;
}

interface RecoverVideoProcessingRequest {
  ownerUid?: string;
  videoId?: string;
  action?: AdminVideoProcessingRecoveryAction;
  reason?: string;
  operationId?: string;
  expectedProcessingVersion?: string;
}

interface RecoverVideoProcessingResponse {
  ownerUid: string;
  videoId: string;
  previousState: VideoProcessingJobState;
  nextState: VideoProcessingJobState;
  action: AdminVideoProcessingRecoveryAction;
  alreadyApplied: boolean;
  cleanupPending: boolean;
}

interface PrivateVideoDocument {
  path?: string;
  url?: string;
  thumbnailPath?: string | null;
  thumbnailUrl?: string | null;
  processedStoragePath?: string | null;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
}

interface ProcessingCleanupJob {
  ownerUid: string;
  videoId: string;
  outputPrefix: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

const ACTIONABLE_STATES: VideoProcessingJobState[] = [
  'FAILED',
  'QUEUED',
  'SUBMITTING',
  'PROCESSING',
  'CANCEL_REQUESTED',
];
const MAX_LIST_LIMIT = 60;
const DEFAULT_LIST_LIMIT = 30;
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MIN_VIDEO_DURATION_MS = 5_000;
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const OUTPUT_CLEANUP_COLLECTION =
  'media_video_processing_output_cleanup_jobs';
const OUTPUT_CLEANUP_BATCH_SIZE = 30;
const ADMIN_RECOVERY_LIST_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 12,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 40,
});
const ADMIN_RECOVERY_MUTATION_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 12,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 40,
});

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanOperationId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(normalized) ? normalized : '';
}

function cleanReason(value: unknown): string {
  return String(value ?? '').trim().slice(0, 900);
}

function normalizeAction(
  value: unknown
): AdminVideoProcessingRecoveryAction | null {
  const action = String(value ?? '').trim().toUpperCase();

  if (
    action === 'RETRY_FAILED' ||
    action === 'RECHECK_STALE' ||
    action === 'RECHECK_UNCONFIRMED' ||
    action === 'RECHECK_PROVIDER' ||
    action === 'CANCEL_ACTIVE'
  ) {
    return action;
  }

  return null;
}

function normalizeState(value: unknown): VideoProcessingJobState | null {
  const state = String(value ?? '').trim().toUpperCase();

  return ACTIONABLE_STATES.includes(state as VideoProcessingJobState)
    ? state as VideoProcessingJobState
    : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.trunc(numberValue)
    : 0;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : null;
}

function normalizeLimit(value: unknown): number {
  const numberValue = Number(value ?? DEFAULT_LIST_LIMIT);

  if (!Number.isFinite(numberValue)) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(numberValue)));
}

function assertAdmin(requestAuth: unknown): string {
  const authData = requestAuth as {
    uid?: unknown;
    token?: unknown;
  } | null | undefined;
  const adminUid = cleanId(authData?.uid);
  const token = typeof authData?.token === 'object' && authData.token !== null
    ? authData.token as Record<string, unknown>
    : {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const allowed = token['admin'] === true ||
    token['role'] === 'admin' ||
    roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem recuperar o processamento de vídeos.'
    );
  }

  return adminUid;
}

function isStale(
  state: VideoProcessingJobState,
  updatedAt: number,
  checkedAt: number
): boolean {
  const threshold = VIDEO_TRIAGE_STALE_AFTER_MS[state];
  return threshold !== undefined && checkedAt - updatedAt > threshold;
}

function normalizeRecoveryItem(
  jobId: string,
  data: unknown,
  checkedAt: number
): RecoveryJobItem | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const job = data as Partial<VideoProcessingJob> & {
    lastAdminOperationId?: unknown;
  };
  const ownerUid = cleanId(job.ownerUid);
  const videoId = cleanId(job.videoId);
  const state = normalizeState(job.state);

  if (!ownerUid || !videoId || !state) {
    return null;
  }

  // Legacy records can lack updatedAt and sometimes createdAt. Never
  // invent an ancient timestamp or claim freshness from zero/null.
  const validTimestamp = (value: unknown): number | null =>
    typeof value === 'number' && Number.isSafeInteger(value) &&
      value > 0 && value <= checkedAt ? value : null;
  const createdAt = validTimestamp(job.createdAt) ?? 0;
  const lastUpdated = validTimestamp(job.updatedAt);
  const timestampEvidence = lastUpdated !== null ? 'UPDATED' as const
    : createdAt > 0 ? 'CREATED_FALLBACK' as const : 'UNVERIFIED' as const;
  const updatedAt = lastUpdated ?? createdAt;
  const ageMs = updatedAt > 0 ? checkedAt - updatedAt : 0;
  const stale = timestampEvidence !== 'UNVERIFIED' &&
    isStale(state, updatedAt, checkedAt);

  return {
    jobId,
    ownerUid,
    videoId,
    processingVersion: String(job.processingVersion ?? ''),
    state,
    attempts: normalizeNonNegativeInteger(job.attempts),
    createdAt,
    updatedAt,
    ageMs,
    stale,
    timestampEvidence,
    hasExternalJob: !!String(job.externalJobName ?? '').trim(),
    requiresProviderReview: videoRecoveryRequiresProviderReview({ ...job, state }),
    requiresOperationalAttention: isOverdueVideoCancellation(
      { ...job, state }, checkedAt
    ),
    providerPollFailureCount: normalizeNonNegativeInteger(job.providerPollFailureCount),
    providerPollLastFailedAt:
      typeof job.providerPollLastFailedAt === 'number' &&
        Number.isSafeInteger(job.providerPollLastFailedAt) &&
        job.providerPollLastFailedAt > 0
        ? job.providerPollLastFailedAt : null,
    providerPollReviewRequired: isProviderPollReviewRequired({ ...job, state }),
    unconfirmedSubmission: isUnconfirmedVideoSubmission({ ...job, state }),
    lastErrorCode: String(job.lastErrorCode ?? '').trim() || null,
    lastError: String(job.lastError ?? '').trim().slice(0, 500) || null,
    availableActions: availableAdminVideoRecoveryActions({ ...job, state }, stale),
  };
}

/**
 * Cursor is a deterministic document-ID position for each actionable state.
 * Consume every scanned document before advancing; never post-sort and slice.
 * Priority and age ranking are scoped to each returned batch, not the queue.
 */
type RecoveryCursor = Partial<Record<VideoProcessingJobState, string>>;
const CURSOR_MAX = 2048;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,260}$/;

function parseRecoveryCursor(value: unknown): RecoveryCursor {
  if (value == null || value === '') return {};
  if (typeof value !== 'string' || value.length > CURSOR_MAX ||
      !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpsError('invalid-argument', 'Cursor de recuperação inválido.');
  }
  try {
    const input = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      v?: unknown; p?: Record<string, unknown>;
    };
    if (input?.v !== 1 || !input.p || typeof input.p !== 'object' ||
        Array.isArray(input.p) ||
        Object.keys(input.p).some(k =>
          !ACTIONABLE_STATES.includes(k as VideoProcessingJobState))) {
      throw new Error('Invalid cursor');
    }
    const positions: RecoveryCursor = {};
    for (const state of ACTIONABLE_STATES) {
      const id = input.p[state];
      if (id !== undefined) {
        if (typeof id !== 'string' || !DOCUMENT_ID.test(id)) {
          throw new Error('Invalid cursor position');
        }
        positions[state] = id;
      }
    }
    return positions;
  } catch {
    throw new HttpsError('invalid-argument', 'Cursor de recuperação inválido.');
  }
}

function encodeRecoveryCursor(positions: RecoveryCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, p: positions })).toString('base64url');
}

async function listRecoveryItems(
  limit: number, checkedAt: number, cursor: RecoveryCursor
): Promise<Omit<ListRecoveryJobsResponse, 'checkedAt'>> {
  const collection = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION);
  const perStateLimit = Math.max(1, Math.floor(limit / ACTIONABLE_STATES.length));
  const snapshots = await Promise.all(ACTIONABLE_STATES.map(state => {
    let query = collection.where('state', '==', state)
      .orderBy(FieldPath.documentId());
    if (cursor[state]) query = query.startAfter(cursor[state]);
    return query.limit(perStateLimit + 1).get();
  }));
  const items: RecoveryJobItem[] = [];
  let skippedItems = 0;
  let scanned = 0;
  let hasMore = false;
  const next: RecoveryCursor = { ...cursor };
  for (let index = 0; index < ACTIONABLE_STATES.length; index++) {
    const documents = snapshots[index].docs;
    if (documents.length > perStateLimit) hasMore = true;
    const consumed = documents.slice(0, perStateLimit);
    scanned += consumed.length;
    if (consumed.length) {
      next[ACTIONABLE_STATES[index]] = consumed[consumed.length - 1].id;
    }
    for (const document of consumed) {
      const item = normalizeRecoveryItem(document.id, document.data(), checkedAt);
      if (item) items.push(item);
      else skippedItems += 1;
    }
  }
  items.sort(compareAdminTriageJobs);
  return {
    items, skippedItems, scanned, hasMore,
    nextCursor: hasMore ? encodeRecoveryCursor(next) : null,
    orderScope: 'WITHIN_PAGE',
    audit: auditRecoveryQueuePage(items, skippedItems),
  };
}

function privateVideoSourcePath(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): string | null {
  return (
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url)
  );
}

function privatePosterPath(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): string | null {
  return (
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailPath
    ) ??
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailUrl
    )
  );
}

async function buildRetryJob(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): Promise<VideoProcessingJob> {
  const sourceStoragePath = privateVideoSourcePath(ownerUid, videoId, video);
  const sourcePosterStoragePath = privatePosterPath(ownerUid, videoId, video);

  if (!sourceStoragePath || String(video.processedStoragePath ?? '').trim()) {
    throw new HttpsError(
      'failed-precondition',
      'O vídeo privado não está elegível para novo processamento.'
    );
  }

  const [metadata] = await storage
    .bucket()
    .file(sourceStoragePath)
    .getMetadata();
  const sourceMimeType = String(metadata.contentType ?? video.mimeType ?? '')
    .trim()
    .toLowerCase();
  const sourceSizeBytes = normalizePositiveInteger(metadata.size ?? video.sizeBytes);
  const sourceDurationMs = normalizePositiveInteger(video.durationMs);

  if (
    !ALLOWED_VIDEO_TYPES.has(sourceMimeType) ||
    !sourceSizeBytes ||
    sourceSizeBytes > MAX_VIDEO_SIZE_BYTES ||
    (sourceDurationMs !== null && sourceDurationMs < MIN_VIDEO_DURATION_MS)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A origem privada não atende aos requisitos de processamento.'
    );
  }

  return buildQueuedVideoProcessingJob({
    ownerUid,
    videoId,
    sourceStoragePath,
    sourcePosterStoragePath,
    sourceMimeType,
    sourceSizeBytes,
    sourceDurationMs,
  });
}

function cleanupJobId(jobId: string, processingVersion: string): string {
  return `${jobId}_${processingVersion}`.slice(0, 500);
}

export async function retryFailedJob(command: {
  adminUid: string;
  ownerUid: string;
  videoId: string;
  operationId: string;
  reason: string;
}, injected?: {
  firestore: Firestore;
  prepareRetry: typeof buildRetryJob;
}): Promise<RecoverVideoProcessingResponse> {
  const firestore = injected?.firestore ?? db;
  const prepareRetry = injected?.prepareRetry ?? buildRetryJob;
  const jobId = buildVideoProcessingJobId(command.ownerUid, command.videoId);
  const jobRef = firestore.collection(VIDEO_PROCESSING_JOBS_COLLECTION).doc(jobId);
  const videoRef = firestore.doc(`users/${command.ownerUid}/videos/${command.videoId}`);
  const deletionRef = firestore.collection('media_video_deletion_jobs')
    .doc(jobId);
  const identityRef = firestore.doc(
    `users/${command.ownerUid}/video_identity_guards/${command.videoId}`);
  const [jobSnapshot, videoSnapshot] = await Promise.all([
    jobRef.get(),
    videoRef.get(),
  ]);

  if (!jobSnapshot.exists || !videoSnapshot.exists) {
    throw new HttpsError('not-found', 'Job ou vídeo privado não encontrado.');
  }

  const previousJob = jobSnapshot.data() as Partial<VideoProcessingJob>;
  const previousState = normalizeState(previousJob.state);

  if (previousState !== 'FAILED') {
    throw new HttpsError(
      'failed-precondition',
      'Somente jobs com falha podem ser reprocessados.'
    );
  }
  if (isUnsafeVideoProcessingRetry({ ...previousJob, state: previousState })) {
    throw new HttpsError(
      'failed-precondition',
      'A submissão externa ainda não foi confirmada. Não reenvie este vídeo.'
    );
  }

  const retryJob = await prepareRetry(
    command.ownerUid,
    command.videoId,
    videoSnapshot.data() as PrivateVideoDocument
  );
  const adminLogRef = firestore.collection('admin_logs').doc();
  const mutationEventId = randomUUID();
  const cleanupRef = firestore.collection(OUTPUT_CLEANUP_COLLECTION).doc(
    cleanupJobId(jobId, String(previousJob.processingVersion ?? 'legacy'))
  );

  return firestore.runTransaction(async (transaction) => {
    const [currentJobSnapshot, currentVideoSnapshot, pendingDeletion, identity] =
      await Promise.all([
        transaction.get(jobRef),
        transaction.get(videoRef),
        transaction.get(deletionRef),
        transaction.get(identityRef),
      ]);
    // A deletion queue or permanently retired identity always wins over
    // an administrative retry, including an idempotent operation replay.
    // Reading inside this transaction fences concurrent profile deletion.
    if (pendingDeletion.exists || (identity.exists && (
      identity.get('state') !== 'REGISTERED' ||
      identity.get('ownerUid') !== command.ownerUid ||
      identity.get('videoId') !== command.videoId))) {
      throw new HttpsError('failed-precondition',
        'A identidade do vídeo está em exclusão ou já foi aposentada.');
    }

    if (!currentJobSnapshot.exists || !currentVideoSnapshot.exists) {
      throw new HttpsError('not-found', 'Job ou vídeo privado não encontrado.');
    }

    const currentJob = currentJobSnapshot.data() as Partial<VideoProcessingJob> & {
      lastAdminOperationId?: string;
    };
    const currentState = normalizeState(currentJob.state);

    if (currentJob.lastAdminOperationId === command.operationId) {
      return {
        ownerUid: command.ownerUid,
        videoId: command.videoId,
        previousState: 'FAILED',
        nextState: currentState ?? 'QUEUED',
        action: 'RETRY_FAILED',
        alreadyApplied: true,
        cleanupPending: false,
      };
    }

    if (currentState !== 'FAILED') {
      throw new HttpsError(
        'failed-precondition',
        'O estado do job mudou antes da confirmação.'
      );
    }
    if (isUnsafeVideoProcessingRetry({ ...currentJob, state: currentState })) {
      throw new HttpsError(
        'failed-precondition',
        'Job com submissão externa incerta: reprocessamento bloqueado.'
      );
    }

    const currentVideo = currentVideoSnapshot.data() as PrivateVideoDocument;

    if (
      privateVideoSourcePath(command.ownerUid, command.videoId, currentVideo) !==
      retryJob.sourceStoragePath ||
      String(currentVideo.processedStoragePath ?? '').trim()
    ) {
      throw new HttpsError(
        'failed-precondition',
        'O arquivo privado mudou antes do reprocessamento.'
      );
    }

    const now = Date.now();
    // Commit the old version's cleanup proof atomically with replacement.
    const tempCleanupQueued = await preserveTerminalCleanupBeforeRetry(
      firestore, transaction, jobId, currentJob as VideoProcessingJob, now
    );
    stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
      eventId: mutationEventId, source: 'ADMIN_RECOVERY',
      kind: 'VERSION_REPLACED', before: currentJobSnapshot,
      afterState: 'QUEUED',
      nextProcessingVersion: retryJob.processingVersion,
    });
    transaction.set(jobRef, withAdminTriageProjection(jobId, null, {
      ...retryJob,
      lastAdminOperationId: command.operationId,
      lastAdminAction: 'RETRY_FAILED',
      lastAdminBy: command.adminUid,
      lastAdminAt: now,
    }, now));
    transaction.set(
      videoRef,
      {
        processingJobId: jobId,
        status: 'queued',
        processingStage: 'queued',
        processingErrorCode: null,
        processingErrorMessage: null,
        processedStoragePath: FieldValue.delete(),
        playbackPath: FieldValue.delete(),
        processedOutputPrefix: FieldValue.delete(),
        processedMimeType: FieldValue.delete(),
        processedSizeBytes: FieldValue.delete(),
        processingCompletedAt: FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true }
    );

    const previousPrefix = normalizeOwnedProcessedVideoPrefix(
      command.ownerUid,
      command.videoId,
      currentJob.outputPrefix
    );

    if (previousPrefix && previousPrefix !== retryJob.outputPrefix) {
      const cleanupJob: ProcessingCleanupJob = {
        ownerUid: command.ownerUid,
        videoId: command.videoId,
        outputPrefix: previousPrefix,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        lastError: null,
      };
      transaction.set(cleanupRef, cleanupJob);
    }

    transaction.set(adminLogRef, {
      adminUid: command.adminUid,
      action: 'videoProcessingRecovery',
      targetUserUid: command.ownerUid,
      details: {
        videoId: command.videoId,
        operation: 'RETRY_FAILED',
        operationId: command.operationId,
        previousState: currentState,
        nextState: 'QUEUED',
        reason: command.reason,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      previousState: currentState,
      nextState: 'QUEUED',
      action: 'RETRY_FAILED',
      alreadyApplied: false,
      cleanupPending: !!previousPrefix || tempCleanupQueued,
    };
  });
}

export async function mutateExistingJob(command: {
  adminUid: string;
  ownerUid: string;
  videoId: string;
  action: Exclude<AdminVideoProcessingRecoveryAction, 'RETRY_FAILED'>;
  operationId: string;
  expectedProcessingVersion?: string;
  reason: string;
}, injected?: { firestore: Firestore }): Promise<RecoverVideoProcessingResponse> {
  const firestore = injected?.firestore ?? db;
  const jobId = buildVideoProcessingJobId(command.ownerUid, command.videoId);
  const jobRef = firestore.collection(VIDEO_PROCESSING_JOBS_COLLECTION).doc(jobId);
  const videoRef = firestore.doc(`users/${command.ownerUid}/videos/${command.videoId}`);
  const deletionRef = firestore.collection('media_video_deletion_jobs').doc(jobId);
  const identityRef = firestore.doc(
    `users/${command.ownerUid}/video_identity_guards/${command.videoId}`);
  const adminLogRef = firestore.collection('admin_logs').doc();
  const mutationEventId = randomUUID();

  return firestore.runTransaction(async (transaction) => {
    const [jobSnapshot, videoSnapshot, pendingDeletion, identity] =
      await Promise.all([
        transaction.get(jobRef),
        transaction.get(videoRef),
        transaction.get(deletionRef),
        transaction.get(identityRef),
      ]);
    // A retired identity or pending deletion fences even a same-state recheck.
    if (pendingDeletion.exists || (identity.exists && (
      identity.get('state') !== 'REGISTERED' ||
      identity.get('ownerUid') !== command.ownerUid ||
      identity.get('videoId') !== command.videoId))) {
      throw new HttpsError('failed-precondition',
        'O vídeo está em exclusão ou sua identidade foi aposentada.');
    }

    if (!jobSnapshot.exists || !videoSnapshot.exists) {
      throw new HttpsError('not-found', 'Job ou vídeo privado não encontrado.');
    }

    const job = jobSnapshot.data() as Partial<VideoProcessingJob> & {
      lastAdminOperationId?: string;
      lastAdminAction?: string;
    };
    const state = normalizeState(job.state);

    if (!state) {
      throw new HttpsError('failed-precondition', 'Estado do job inválido.');
    }

    // All actions originate from a versioned admin row, not only provider
    // rechecks. Versionless legacy commands fail closed against new retries.
    if (!command.expectedProcessingVersion ||
        job.processingVersion !== command.expectedProcessingVersion) {
      throw new HttpsError(
        'failed-precondition',
        'Versão do processamento alterada antes da ação administrativa.'
      );
    }
    if (job.lastAdminOperationId === command.operationId &&
        job.lastAdminAction !== command.action) {
      throw new HttpsError('failed-precondition',
        'Identificador de operação já utilizado para outra ação.');
    }

    if (job.lastAdminOperationId === command.operationId) {
      return {
        ownerUid: command.ownerUid,
        videoId: command.videoId,
        previousState: state,
        nextState: state,
        action: command.action,
        alreadyApplied: true,
        cleanupPending: command.action === 'CANCEL_ACTIVE',
      };
    }

    const now = Date.now();
    let nextState: VideoProcessingJobState = state;
    const jobPatch: Record<string, unknown> = {
      lastAdminOperationId: command.operationId,
      lastAdminAction: command.action,
      lastAdminBy: command.adminUid,
      lastAdminAt: now,
      updatedAt: now,
    };
    const videoPatch: Record<string, unknown> = { updatedAt: now };

    if (command.action === 'RECHECK_UNCONFIRMED') {
      if (!isUnconfirmedVideoSubmission({ ...job, state })) {
        throw new HttpsError(
          'failed-precondition',
          'A reconferência exige submissão sem confirmação externa e sem lease ativo.'
        );
      }

      // Only schedule a provider lookup. The scheduler must never create a
      // second Transcoder job from this administrative action.
      jobPatch['leaseUntil'] = 0;
      videoPatch['status'] = 'processing';
      videoPatch['processingStage'] = 'confirming_submission';
    } else if (command.action === 'RECHECK_PROVIDER') {
      if (state !== 'PROCESSING' ||
          !command.expectedProcessingVersion ||
          job.processingVersion !== command.expectedProcessingVersion ||
          !isProviderPollReviewRequired({ ...job, state })) {
        throw new HttpsError(
          'failed-precondition',
          'Reconferência exige falhas persistentes de consulta ao Transcoder.'
        );
      }
      // A new reservation invalidates all older polling claims without a POST.
      jobPatch['nextAttemptAt'] = now;
      jobPatch['providerPollReviewRequired'] = false;
      videoPatch['status'] = 'processing';
      videoPatch['processingStage'] = 'processing';
    } else if (command.action === 'RECHECK_STALE') {
      if (state === 'SUBMITTING' &&
        job.lastErrorCode === 'SUBMISSION_UNCONFIRMED') {
        throw new HttpsError(
          'failed-precondition',
          'Utilize a reconferência explícita da submissão não confirmada.'
        );
      }
      if (state !== 'QUEUED' && state !== 'SUBMITTING') {
        throw new HttpsError(
          'failed-precondition',
          'Somente jobs em fila ou submissão podem ser revalidados.'
        );
      }

      const updatedAt = normalizeNonNegativeInteger(job.updatedAt);

      if (!isStale(state, updatedAt, now)) {
        throw new HttpsError(
          'failed-precondition',
          'O job ainda não atingiu o limite de atraso para revalidação.'
        );
      }

      if (state === 'QUEUED') {
        jobPatch['nextAttemptAt'] = now;
        jobPatch['leaseUntil'] = null;
        videoPatch['status'] = 'queued';
        videoPatch['processingStage'] = 'queued';
      } else {
        jobPatch['leaseUntil'] = 0;
        videoPatch['status'] = 'processing';
        videoPatch['processingStage'] = 'confirming_submission';
      }
      jobPatch['lastErrorCode'] = null;
      jobPatch['lastError'] = null;
      videoPatch['processingErrorCode'] = null;
      videoPatch['processingErrorMessage'] = null;
    } else {
      if (
        state !== 'QUEUED' &&
        state !== 'SUBMITTING' &&
        state !== 'PROCESSING' &&
        state !== 'CANCEL_REQUESTED'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este job não está ativo para cancelamento.'
        );
      }

      if (state === 'CANCEL_REQUESTED') {
        return {
          ownerUid: command.ownerUid,
          videoId: command.videoId,
          previousState: state,
          nextState: state,
          action: command.action,
          alreadyApplied: true,
          cleanupPending: true,
        };
      }

      nextState = 'CANCEL_REQUESTED';
      jobPatch['state'] = nextState;
      jobPatch['cancelRequestedAt'] = now;
      jobPatch['nextAttemptAt'] = now;
      jobPatch['cancellationCleanupAttempts'] = 0;
      jobPatch['cancellationReviewRequired'] = false;
      jobPatch['leaseUntil'] = null;
      jobPatch['lastErrorCode'] = 'ADMIN_CANCELLED';
      jobPatch['lastError'] = command.reason;
      videoPatch['status'] = 'failed';
      videoPatch['processingStage'] = 'failed';
      videoPatch['processingErrorCode'] = 'ADMIN_CANCELLED';
      videoPatch['processingErrorMessage'] =
        'O processamento foi cancelado pela administração.';
    }

    if (nextState !== state) {
      stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
        eventId: mutationEventId, source: 'ADMIN_RECOVERY',
        kind: 'STATE_TRANSITION', before: jobSnapshot,
        afterState: nextState,
      });
    }
    transaction.set(jobRef, withAdminTriageProjection(jobId, job, jobPatch, now), { merge: true });
    transaction.set(videoRef, videoPatch, { merge: true });
    transaction.set(adminLogRef, {
      adminUid: command.adminUid,
      action: 'videoProcessingRecovery',
      targetUserUid: command.ownerUid,
      details: {
        videoId: command.videoId,
        operation: command.action,
        operationId: command.operationId,
        previousState: state,
        nextState,
        reason: command.reason,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      previousState: state,
      nextState,
      action: command.action,
      alreadyApplied: false,
      cleanupPending: command.action === 'CANCEL_ACTIVE',
    };
  });
}

function normalizeCleanupJob(data: unknown): ProcessingCleanupJob | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const job = data as Partial<ProcessingCleanupJob>;
  const ownerUid = cleanId(job.ownerUid);
  const videoId = cleanId(job.videoId);
  const outputPrefix = normalizeOwnedProcessedVideoPrefix(
    ownerUid,
    videoId,
    job.outputPrefix
  );

  if (!ownerUid || !videoId || !outputPrefix) {
    return null;
  }

  return {
    ownerUid,
    videoId,
    outputPrefix,
    createdAt: normalizeNonNegativeInteger(job.createdAt),
    updatedAt: normalizeNonNegativeInteger(job.updatedAt),
    attempts: normalizeNonNegativeInteger(job.attempts),
    lastError: String(job.lastError ?? '').trim().slice(0, 500) || null,
  };
}

async function deleteOutputPrefix(outputPrefix: string): Promise<void> {
  const [files] = await storage.bucket().getFiles({ prefix: outputPrefix });
  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

export const listVideoProcessingRecoveryJobs = onCall<ListRecoveryJobsRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<ListRecoveryJobsResponse> => {
    assertCallableAppCheck(request.app);
    const adminUid = assertAdmin(request.auth);
    const checkedAt = Date.now();
    const limit = normalizeLimit(request.data?.limit);
    await consumeBackendRateLimitQuota({
      action: 'admin-video-processing-recovery-list',
      subject: adminUid,
      cost: Math.max(1, Math.ceil(limit / 15)),
      config: ADMIN_RECOVERY_LIST_RATE_LIMIT,
      message: 'Muitas consultas de recuperação de vídeo foram feitas em pouco tempo.',
    });
    const cursor = parseRecoveryCursor(request.data?.cursor);
    const result = await listRecoveryItems(limit, checkedAt, cursor);

    return {
      ...result,
      checkedAt,
    };
  }
);

export const recoverVideoProcessingJob = onCall<RecoverVideoProcessingRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<RecoverVideoProcessingResponse> => {
    assertCallableAppCheck(request.app);
    const adminUid = assertAdmin(request.auth);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const action = normalizeAction(request.data?.action);
    const operationId = cleanOperationId(request.data?.operationId);
    const reason = cleanReason(request.data?.reason);
    const expectedProcessingVersion = cleanId(request.data?.expectedProcessingVersion);

    if (!ownerUid || !videoId || !action || !operationId) {
      throw new HttpsError('invalid-argument', 'Comando de recuperação inválido.');
    }

    if (reason.length < 8) {
      throw new HttpsError(
        'invalid-argument',
        'Informe uma justificativa objetiva, com pelo menos 8 caracteres.'
      );
    }

    await consumeBackendRateLimitQuota({
      action: 'admin-video-processing-recovery-mutate',
      subject: adminUid,
      config: ADMIN_RECOVERY_MUTATION_RATE_LIMIT,
      message: 'Muitas operações de recuperação de vídeo foram solicitadas em pouco tempo.',
    });

    try {
      if (action === 'RETRY_FAILED') {
        return await retryFailedJob({
          adminUid,
          ownerUid,
          videoId,
          operationId,
          reason,
        });
      }

      return await mutateExistingJob({
        adminUid,
        ownerUid,
        videoId,
        action,
        operationId,
        expectedProcessingVersion,
        reason,
      });
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error('[videoProcessingRecovery] Falha administrativa.', {
        adminUid,
        ownerUid,
        videoId,
        action,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });
      throw new HttpsError(
        'internal',
        'Não foi possível concluir a recuperação do processamento.'
      );
    }
  }
);

export const cleanupRetriedVideoProcessingOutputs = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const snapshot = await db
      .collection(OUTPUT_CLEANUP_COLLECTION)
      .limit(OUTPUT_CLEANUP_BATCH_SIZE)
      .get();

    for (const document of snapshot.docs) {
      const job = normalizeCleanupJob(document.data());

      if (!job) {
        logger.error('[videoProcessingCleanup] Job inválido.', {
          jobId: document.id,
        });
        continue;
      }

      try {
        await deleteOutputPrefix(job.outputPrefix);
        await document.ref.delete();
      } catch (error) {
        await document.ref.set(
          {
            attempts: FieldValue.increment(1),
            updatedAt: Date.now(),
            lastError: error instanceof Error
              ? error.message.slice(0, 500)
              : String(error ?? '').slice(0, 500),
          },
          { merge: true }
        );
        logger.warn('[videoProcessingCleanup] Limpeza pendente.', {
          jobId: document.id,
          ownerUid: job.ownerUid,
          videoId: job.videoId,
          error: error instanceof Error ? error.message : String(error ?? ''),
        });
      }
    }
  }
);
