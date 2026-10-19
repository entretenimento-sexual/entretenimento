/**
 * c18e staged backfill: one bounded, ID-cursored state lane per explicit call.
 * Not exported as a Cloud Function, scheduler, CLI task, or application route.
 * NO production invocation, automatic iteration, provider calls or deployment.
 */
import { FieldPath, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';

import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
  type VideoProcessingJobState,
} from './video-processing-job';
import { projectAdminTriageJob } from './admin-video-global-triage.policy';
import { withAdminTriageProjection } from './admin-video-triage.firestore';

export const VIDEO_TRIAGE_BACKFILL_MAX_PAGE = 20;
export const VIDEO_TRIAGE_BACKFILL_DEFAULT_PAGE = 10;

export const VIDEO_TRIAGE_BACKFILL_STATES = [
  'QUEUED', 'SUBMITTING', 'PROCESSING', 'FAILED', 'CANCEL_REQUESTED',
  'SUCCEEDED', 'CANCELLED',
] as const satisfies readonly VideoProcessingJobState[];

export type VideoTriageBackfillState = typeof VIDEO_TRIAGE_BACKFILL_STATES[number];
export type VideoTriageBackfillMode = 'DRY_RUN' | 'APPLY';
export type VideoTriageBackfillDisposition =
  | 'CURRENT' | 'WOULD_PROJECT' | 'PROJECTED'
  | 'WOULD_CLEAR_TERMINAL' | 'CLEARED_TERMINAL'
  | 'UNVERSIONED' | 'REPLACED' | 'MISSING';

export interface VideoTriageBackfillPageRequest {
  state: VideoTriageBackfillState;
  /** Last *consumed* document ID; never an offset or triage ranking. */
  afterId?: string | null;
  limit?: number;
  /** APPLY must be chosen explicitly; omitted means no writes. */
  mode?: VideoTriageBackfillMode;
  now?: number;
}

export interface VideoTriageBackfillPageResult {
  scope: 'PAGE_ONLY';
  state: VideoTriageBackfillState;
  mode: VideoTriageBackfillMode;
  scanned: number;
  hasMore: boolean;
  nextCursor: string | null;
  outcomes: Record<VideoTriageBackfillDisposition, number>;
  /** Hard upper bounds for this page, not cumulative coverage or actual billing. */
  maxQueryReads: number;
  maxTransactionReads: number;
  maxWrites: number;
  checkedAt: number;
}

const TRIAGE_FIELDS = [
  'adminTriageProjectionVersion', 'adminTriageProcessingVersion',
  'adminTriageTier', 'adminTriageSince', 'adminTriageReevaluateAt',
] as const;

const TERMINAL_STATES = new Set<VideoProcessingJobState>([
  'SUCCEEDED', 'CANCELLED',
]);

function validatePage(request: VideoTriageBackfillPageRequest): {
  mode: VideoTriageBackfillMode;
  limit: number;
  now: number;
} {
  if (!VIDEO_TRIAGE_BACKFILL_STATES.includes(request.state)) {
    throw new RangeError('Unsupported video triage backfill lane.');
  }
  if (request.afterId != null &&
      (typeof request.afterId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,257}$/.test(request.afterId))) {
    throw new RangeError('Invalid video triage document-ID cursor.');
  }
  const limit = request.limit ?? VIDEO_TRIAGE_BACKFILL_DEFAULT_PAGE;
  if (!Number.isSafeInteger(limit) || limit < 1 ||
      limit > VIDEO_TRIAGE_BACKFILL_MAX_PAGE) {
    throw new RangeError('Video triage backfill page exceeds its read budget.');
  }
  const mode = request.mode ?? 'DRY_RUN';
  if (mode !== 'DRY_RUN' && mode !== 'APPLY') {
    throw new RangeError('Unsupported video triage backfill mode.');
  }
  const now = request.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new RangeError('Invalid video triage backfill evaluation clock.');
  }
  return { mode, limit, now };
}

/**
 * An actionable record lacking an authentic version is not repaired by
 * inventing a version. It remains visible to the coverage audit as UNVERSIONED.
 */
function requiredWrite(
  id: string, data: Partial<VideoProcessingJob>, now: number
): 'PROJECT' | 'CLEAR_TERMINAL' | 'NONE' | 'UNVERSIONED' {
  if (TERMINAL_STATES.has(data.state as VideoProcessingJobState)) {
    return TRIAGE_FIELDS.some(field =>
      Object.prototype.hasOwnProperty.call(data, field))
      ? 'CLEAR_TERMINAL' : 'NONE';
  }
  const target = projectAdminTriageJob(id, data, now);
  if (!target) return 'UNVERSIONED';
  return TRIAGE_FIELDS.every(field => data[field] === target[field])
    ? 'NONE' : 'PROJECT';
}

function preview(
  snapshot: DocumentSnapshot, now: number
): VideoTriageBackfillDisposition {
  const action = requiredWrite(snapshot.id,
    snapshot.data() as Partial<VideoProcessingJob>, now);
  if (action === 'PROJECT') return 'WOULD_PROJECT';
  if (action === 'CLEAR_TERMINAL') return 'WOULD_CLEAR_TERMINAL';
  return action === 'UNVERSIONED' ? 'UNVERSIONED' : 'CURRENT';
}

/**
 * Fences the COMPLETE observed document updateTime, not just version/state.
 * An intervening same-version scheduler write also causes REPLACED, so the
 * backfill never tramples an up-to-date live-writer projection.
 */
export async function applyObservedVideoTriageBackfillJob(
  firestore: Firestore, observed: DocumentSnapshot, now: number
): Promise<VideoTriageBackfillDisposition> {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new RangeError('Invalid video triage backfill evaluation clock.');
  }
  if (!observed.exists) return 'MISSING';
  return firestore.runTransaction(async transaction => {
    const current = await transaction.get(observed.ref);
    if (!current.exists) return 'MISSING' as const;
    if (!current.updateTime || !observed.updateTime ||
        !current.updateTime.isEqual(observed.updateTime) ||
        current.get('state') !== observed.get('state') ||
        current.get('processingVersion') !== observed.get('processingVersion')) {
      return 'REPLACED' as const;
    }
    const data = current.data() as Partial<VideoProcessingJob>;
    const required = requiredWrite(current.id, data, now);
    if (required === 'NONE') return 'CURRENT' as const;
    if (required === 'UNVERSIONED') return 'UNVERSIONED' as const;
    transaction.update(current.ref, withAdminTriageProjection(
      current.id, data, {}, now
    ));
    return required === 'PROJECT' ? 'PROJECTED' as const
      : 'CLEARED_TERMINAL' as const;
  }, { maxAttempts: 2 });
}

/**
 * No internal continuation loop: caller can inspect audit counters, stop, and
 * explicitly invoke the next page. A cursor is never global coverage proof.
 */
export async function prepareVideoTriageBackfillPage(
  firestore: Firestore, request: VideoTriageBackfillPageRequest
): Promise<VideoTriageBackfillPageResult> {
  const { mode, limit, now } = validatePage(request);
  let query = firestore.collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('state', '==', request.state)
    .orderBy(FieldPath.documentId());
  if (request.afterId) query = query.startAfter(request.afterId);
  const snapshot = await query.limit(limit + 1).get();
  const consumed = snapshot.docs.slice(0, limit);
  const outcomes: Record<VideoTriageBackfillDisposition, number> = {
    CURRENT: 0, WOULD_PROJECT: 0, PROJECTED: 0,
    WOULD_CLEAR_TERMINAL: 0, CLEARED_TERMINAL: 0,
    UNVERSIONED: 0, REPLACED: 0, MISSING: 0,
  };
  for (const document of consumed) {
    const result = mode === 'APPLY'
      ? await applyObservedVideoTriageBackfillJob(firestore, document, now)
      : preview(document, now);
    outcomes[result]++;
  }
  const hasMore = snapshot.docs.length > limit;
  return {
    scope: 'PAGE_ONLY', state: request.state, mode,
    scanned: consumed.length,
    hasMore,
    nextCursor: hasMore ? consumed[consumed.length - 1].id : null,
    outcomes,
    maxQueryReads: limit + 1,
    maxTransactionReads: mode === 'APPLY' ? consumed.length * 2 : 0,
    maxWrites: mode === 'APPLY' ? consumed.length : 0,
    checkedAt: now,
  };
}
