import { MEDIA_RANKING_VERSION } from './media-engagement-score';

export const PHOTO_RANKING_BACKFILL_ID =
  `photo-ranking-v${MEDIA_RANKING_VERSION}`;
export const PHOTO_RANKING_BACKFILL_COLLECTION =
  'media_ranking_backfills';
export const PHOTO_RANKING_BACKFILL_DEFAULT_PAGE_SIZE = 120;
export const PHOTO_RANKING_BACKFILL_MIN_PAGE_SIZE = 20;
export const PHOTO_RANKING_BACKFILL_MAX_PAGE_SIZE = 180;
export const PHOTO_RANKING_BACKFILL_LEASE_MS = 4 * 60 * 1000;
export const PHOTO_RANKING_BACKFILL_MAX_CONSECUTIVE_FAILURES = 5;

export type PhotoRankingBackfillStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED';

export type PhotoRankingBackfillControlAction =
  | 'START_OR_RESUME'
  | 'PAUSE'
  | 'RUN_PAGE'
  | 'RESET';

export interface PhotoRankingBackfillState {
  version: number;
  status: PhotoRankingBackfillStatus;
  pageSize: number;
  cursorPath: string | null;
  processedCount: number;
  updatedCount: number;
  skippedCount: number;
  pagesCount: number;
  consecutiveFailures: number;
  leaseOwner: string | null;
  leaseExpiresAt: number;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
  lastBatchAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastAdminOperationId: string | null;
  lastAdminAction: PhotoRankingBackfillControlAction | null;
  lastAdminBy: string | null;
  generation: number;
}

export interface PhotoRankingBackfillPublicState {
  version: number;
  status: PhotoRankingBackfillStatus;
  pageSize: number;
  processedCount: number;
  updatedCount: number;
  skippedCount: number;
  pagesCount: number;
  consecutiveFailures: number;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
  lastBatchAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastAdminAction: PhotoRankingBackfillControlAction | null;
  generation: number;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = Number(value ?? 0);

  return Number.isFinite(numeric) && numeric >= 0
    ? Math.trunc(numeric)
    : 0;
}

function normalizeNullableTimestamp(value: unknown): number | null {
  const normalized = normalizeNonNegativeInteger(value);
  return normalized > 0 ? normalized : null;
}

export function normalizePhotoRankingBackfillPageSize(
  value: unknown
): number {
  const numeric = Number(value ?? PHOTO_RANKING_BACKFILL_DEFAULT_PAGE_SIZE);

  if (!Number.isFinite(numeric)) {
    return PHOTO_RANKING_BACKFILL_DEFAULT_PAGE_SIZE;
  }

  return Math.max(
    PHOTO_RANKING_BACKFILL_MIN_PAGE_SIZE,
    Math.min(PHOTO_RANKING_BACKFILL_MAX_PAGE_SIZE, Math.trunc(numeric))
  );
}

export function normalizePhotoRankingBackfillCursorPath(
  value: unknown
): string | null {
  const path = String(value ?? '').trim();

  if (!path) {
    return null;
  }

  return /^public_profiles\/[A-Za-z0-9_-]{1,128}\/public_photos\/[A-Za-z0-9_-]{1,128}$/.test(
    path
  )
    ? path
    : null;
}

export function normalizePhotoRankingBackfillOperationId(
  value: unknown
): string {
  const operationId = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(operationId)
    ? operationId
    : '';
}

export function normalizePhotoRankingBackfillAction(
  value: unknown
): PhotoRankingBackfillControlAction | null {
  const action = String(value ?? '').trim().toUpperCase();

  if (
    action === 'START_OR_RESUME' ||
    action === 'PAUSE' ||
    action === 'RUN_PAGE' ||
    action === 'RESET'
  ) {
    return action;
  }

  return null;
}

export function buildInitialPhotoRankingBackfillState(input: {
  now: number;
  pageSize?: unknown;
  status?: PhotoRankingBackfillStatus;
}): PhotoRankingBackfillState {
  const now = normalizeNonNegativeInteger(input.now);
  const status = input.status ?? 'RUNNING';

  return {
    version: MEDIA_RANKING_VERSION,
    status,
    pageSize: normalizePhotoRankingBackfillPageSize(input.pageSize),
    cursorPath: null,
    processedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    pagesCount: 0,
    consecutiveFailures: 0,
    leaseOwner: null,
    leaseExpiresAt: 0,
    startedAt: status === 'RUNNING' ? now : null,
    updatedAt: now,
    completedAt: null,
    lastBatchAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastAdminOperationId: null,
    lastAdminAction: null,
    lastAdminBy: null,
    generation: 1,
  };
}

export function normalizePhotoRankingBackfillState(
  value: unknown,
  now: number
): PhotoRankingBackfillState {
  if (typeof value !== 'object' || value === null) {
    return buildInitialPhotoRankingBackfillState({ now });
  }

  const data = value as Partial<PhotoRankingBackfillState>;
  const status = String(data.status ?? '').trim().toUpperCase();
  const normalizedStatus: PhotoRankingBackfillStatus =
    status === 'IDLE' ||
    status === 'RUNNING' ||
    status === 'PAUSED' ||
    status === 'COMPLETED' ||
    status === 'FAILED'
      ? status
      : 'RUNNING';

  return {
    version: normalizeNonNegativeInteger(data.version) ||
      MEDIA_RANKING_VERSION,
    status: normalizedStatus,
    pageSize: normalizePhotoRankingBackfillPageSize(data.pageSize),
    cursorPath: normalizePhotoRankingBackfillCursorPath(data.cursorPath),
    processedCount: normalizeNonNegativeInteger(data.processedCount),
    updatedCount: normalizeNonNegativeInteger(data.updatedCount),
    skippedCount: normalizeNonNegativeInteger(data.skippedCount),
    pagesCount: normalizeNonNegativeInteger(data.pagesCount),
    consecutiveFailures: normalizeNonNegativeInteger(
      data.consecutiveFailures
    ),
    leaseOwner: String(data.leaseOwner ?? '').trim() || null,
    leaseExpiresAt: normalizeNonNegativeInteger(data.leaseExpiresAt),
    startedAt: normalizeNullableTimestamp(data.startedAt),
    updatedAt: normalizeNonNegativeInteger(data.updatedAt) ||
      normalizeNonNegativeInteger(now),
    completedAt: normalizeNullableTimestamp(data.completedAt),
    lastBatchAt: normalizeNullableTimestamp(data.lastBatchAt),
    lastErrorCode: String(data.lastErrorCode ?? '').trim().slice(0, 100) ||
      null,
    lastErrorMessage: String(data.lastErrorMessage ?? '')
      .trim()
      .slice(0, 300) || null,
    lastAdminOperationId: normalizePhotoRankingBackfillOperationId(
      data.lastAdminOperationId
    ) || null,
    lastAdminAction: normalizePhotoRankingBackfillAction(
      data.lastAdminAction
    ),
    lastAdminBy: String(data.lastAdminBy ?? '').trim() || null,
    generation: Math.max(1, normalizeNonNegativeInteger(data.generation)),
  };
}

export function buildPhotoRankingBackfillPublicState(
  state: PhotoRankingBackfillState
): PhotoRankingBackfillPublicState {
  return {
    version: state.version,
    status: state.status,
    pageSize: state.pageSize,
    processedCount: state.processedCount,
    updatedCount: state.updatedCount,
    skippedCount: state.skippedCount,
    pagesCount: state.pagesCount,
    consecutiveFailures: state.consecutiveFailures,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
    lastBatchAt: state.lastBatchAt,
    lastErrorCode: state.lastErrorCode,
    lastErrorMessage: state.lastErrorMessage,
    lastAdminAction: state.lastAdminAction,
    generation: state.generation,
  };
}

export function resolvePhotoRankingBackfillControlStatus(input: {
  currentStatus: PhotoRankingBackfillStatus;
  action: PhotoRankingBackfillControlAction;
}): PhotoRankingBackfillStatus {
  if (input.action === 'PAUSE') {
    return 'PAUSED';
  }

  if (input.action === 'RUN_PAGE') {
    return input.currentStatus === 'RUNNING' ? 'RUNNING' : 'PAUSED';
  }

  return 'RUNNING';
}

export function resolvePhotoRankingBackfillPostBatchStatus(input: {
  currentStatus: PhotoRankingBackfillStatus;
  completed: boolean;
}): PhotoRankingBackfillStatus {
  if (input.completed) {
    return 'COMPLETED';
  }

  return input.currentStatus === 'PAUSED' ? 'PAUSED' : 'RUNNING';
}

export function isPhotoRankingBackfillLeaseAvailable(input: {
  state: PhotoRankingBackfillState;
  now: number;
  runId: string;
}): boolean {
  const now = normalizeNonNegativeInteger(input.now);

  return !input.state.leaseOwner ||
    input.state.leaseOwner === input.runId ||
    input.state.leaseExpiresAt <= now;
}

export function nextPhotoRankingBackfillFailureStatus(
  consecutiveFailures: unknown
): PhotoRankingBackfillStatus {
  return normalizeNonNegativeInteger(consecutiveFailures) >=
    PHOTO_RANKING_BACKFILL_MAX_CONSECUTIVE_FAILURES
    ? 'FAILED'
    : 'RUNNING';
}
