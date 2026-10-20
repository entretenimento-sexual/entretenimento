/**
 * c18f offline, opt-in consistency probe and deadline reclassification.
 * Not a scheduler, callable, public reader, global-sort activation or migration.
 * Reading one page never establishes a stable whole-collection snapshot.
 */
import { FieldPath, type Firestore } from 'firebase-admin/firestore';

import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob, type VideoProcessingJobState,
} from './video-processing-job';
import { projectAdminTriageJob } from './admin-video-global-triage.policy';
import {
  applyObservedVideoTriageBackfillJob,
  VIDEO_TRIAGE_BACKFILL_STATES,
  VIDEO_TRIAGE_BACKFILL_MAX_PAGE,
  type VideoTriageBackfillMode, type VideoTriageBackfillDisposition,
  type VideoTriageBackfillState,
} from './admin-video-triage-backfill.firestore';

const PROJECTION_KEYS = [
  'adminTriageProjectionVersion', 'adminTriageProcessingVersion',
  'adminTriageTier', 'adminTriageSince', 'adminTriageReevaluateAt',
] as const;
const TERMINAL = new Set<VideoProcessingJobState>(['SUCCEEDED', 'CANCELLED']);

export type VideoTriageIntegrity =
  'CURRENT' | 'MISSING_PROJECTION' | 'STALE_VERSION' |
  'DIVERGENT' | 'TIME_DUE' | 'TERMINAL_RESIDUE' |
  'UNVERSIONED' | 'TERMINAL_CLEAR';

export interface VideoTriageIntegrityPage {
  scope: 'PAGE_ONLY';
  state: VideoTriageBackfillState;
  checkedAt: number;
  observed: number;
  counts: Record<VideoTriageIntegrity, number>;
  nextCursor: string | null;
  hasMore: boolean;
  maxQueryReads: number;
  /** Always false: a page can skip moves between state lanes or ID ranges. */
  provesGlobalCoverage: false;
}

export interface VideoTriageDueCursor {
  dueAt: number;
  jobId: string;
}
export interface VideoTriageDuePage {
  scope: 'PAGE_ONLY';
  mode: VideoTriageBackfillMode;
  cutoff: number;
  observed: number;
  nextCursor: VideoTriageDueCursor | null;
  hasMore: boolean;
  counts: Record<VideoTriageBackfillDisposition, number>;
  maxQueryReads: number;
  maxTransactionReads: number;
  maxWrites: number;
  /** Expiring fields cannot prove missing projections or terminal coverage. */
  provesGlobalCoverage: false;
}

function finiteTime(now: number): void {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new RangeError('Triage evaluation requires a valid clock.');
  }
}

function boundedLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 ||
      limit > VIDEO_TRIAGE_BACKFILL_MAX_PAGE) {
    throw new RangeError('Triage consistency read budget exceeded.');
  }
}

function documentId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,257}$/.test(id)) {
    throw new RangeError('Invalid triage cursor document ID.');
  }
}

function integrityCounts(): Record<VideoTriageIntegrity, number> {
  return {
    CURRENT: 0, MISSING_PROJECTION: 0, STALE_VERSION: 0,
    DIVERGENT: 0, TIME_DUE: 0, TERMINAL_RESIDUE: 0,
    UNVERSIONED: 0, TERMINAL_CLEAR: 0,
  };
}

function reclassificationCounts(): Record<VideoTriageBackfillDisposition, number> {
  return {
    CURRENT: 0, WOULD_PROJECT: 0, PROJECTED: 0,
    WOULD_CLEAR_TERMINAL: 0, CLEARED_TERMINAL: 0,
    UNVERSIONED: 0, REPLACED: 0, MISSING: 0,
  };
}

/** Independent read-only truth: compare the complete five-field projection. */
export function auditVideoTriageIntegrity(
  id: string, data: Partial<VideoProcessingJob>, now: number
): VideoTriageIntegrity {
  finiteTime(now);
  const fieldsPresent = PROJECTION_KEYS.filter(field =>
    Object.prototype.hasOwnProperty.call(data, field));
  if (TERMINAL.has(data.state as VideoProcessingJobState)) {
    return fieldsPresent.length ? 'TERMINAL_RESIDUE' : 'TERMINAL_CLEAR';
  }
  const desired = projectAdminTriageJob(id, data, now);
  if (!desired) return 'UNVERSIONED';
  if (fieldsPresent.length !== PROJECTION_KEYS.length) return 'MISSING_PROJECTION';
  if (data.adminTriageProcessingVersion !== desired.adminTriageProcessingVersion ||
      data.adminTriageProjectionVersion !== desired.adminTriageProjectionVersion) {
    return 'STALE_VERSION';
  }
  if (PROJECTION_KEYS.every(key => data[key] === desired[key])) return 'CURRENT';
  const due = data.adminTriageReevaluateAt;
  if (typeof due === 'number' && Number.isSafeInteger(due) &&
      due > 0 && due <= now) return 'TIME_DUE';
  return 'DIVERGENT';
}

/** Bounded per-state ID sweep; never claim a global consistent census. */
export async function auditVideoTriageIntegrityPage(
  db: Firestore, request: {
    state: VideoTriageBackfillState;
    afterId?: string | null;
    limit?: number;
    now?: number;
  }
): Promise<VideoTriageIntegrityPage> {
  if (!VIDEO_TRIAGE_BACKFILL_STATES.includes(request.state)) {
    throw new RangeError('Unknown triage state lane.');
  }
  const limit = request.limit ?? 10;
  const now = request.now ?? Date.now();
  finiteTime(now);
  boundedLimit(limit);
  if (request.afterId != null) documentId(request.afterId);
  let query = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('state', '==', request.state).orderBy(FieldPath.documentId());
  if (request.afterId) query = query.startAfter(request.afterId);
  const docs = (await query.limit(limit + 1).get()).docs;
  const consumed = docs.slice(0, limit);
  const counts = integrityCounts();
  for (const doc of consumed) {
    counts[auditVideoTriageIntegrity(doc.id,
      doc.data() as Partial<VideoProcessingJob>, now)]++;
  }
  const hasMore = docs.length > limit;
  return {
    scope: 'PAGE_ONLY', state: request.state, checkedAt: now,
    observed: consumed.length, counts, hasMore,
    nextCursor: hasMore ? consumed[consumed.length - 1].id : null,
    maxQueryReads: limit + 1, provesGlobalCoverage: false,
  };
}

/**
 * Selects only indexed, positive, due re-evaluation deadlines.
 * Composite index is DECLARED, NOT DEPLOYED by this change; without READY
 * this query may fail and the failure must not be converted to an empty page.
 */
export async function reclassifyDueVideoTriagePage(
  db: Firestore, request: {
    now?: number;
    limit?: number;
    after?: VideoTriageDueCursor | null;
    mode?: VideoTriageBackfillMode;
  }
): Promise<VideoTriageDuePage> {
  const now = request.now ?? Date.now();
  const limit = request.limit ?? 10;
  const mode = request.mode ?? 'DRY_RUN';
  finiteTime(now);
  boundedLimit(limit);
  if (mode !== 'DRY_RUN' && mode !== 'APPLY') {
    throw new RangeError('Triage reclassification requires explicit APPLY.');
  }
  if (request.after != null) {
    finiteTime(request.after.dueAt);
    documentId(request.after.jobId);
    if (request.after.dueAt > now) {
      throw new RangeError('Triage cursor exceeds evaluation cutoff.');
    }
  }
  let query = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('adminTriageReevaluateAt', '>', 0)
    .where('adminTriageReevaluateAt', '<=', now)
    .orderBy('adminTriageReevaluateAt')
    .orderBy(FieldPath.documentId());
  if (request.after) {
    query = query.startAfter(request.after.dueAt, request.after.jobId);
  }
  const docs = (await query.limit(limit + 1).get()).docs;
  const consumed = docs.slice(0, limit);
  const counts = reclassificationCounts();
  for (const doc of consumed) {
    const expected = auditVideoTriageIntegrity(
      doc.id, doc.data() as Partial<VideoProcessingJob>, now);
    const outcome: VideoTriageBackfillDisposition = mode === 'APPLY'
      ? await applyObservedVideoTriageBackfillJob(db, doc, now)
      : expected === 'TERMINAL_RESIDUE' ? 'WOULD_CLEAR_TERMINAL'
        : expected === 'UNVERSIONED' ? 'UNVERSIONED'
          : expected === 'CURRENT' || expected === 'TERMINAL_CLEAR'
            ? 'CURRENT' : 'WOULD_PROJECT';
    counts[outcome]++;
  }
  const hasMore = docs.length > limit;
  const last = consumed[consumed.length - 1];
  const dueAt = last?.get('adminTriageReevaluateAt') as unknown;
  if (hasMore && (!Number.isSafeInteger(dueAt) ||
      typeof dueAt !== 'number' || dueAt <= 0 || dueAt > now)) {
    throw new Error('Invalid triage due cursor in indexed result.');
  }
  return {
    scope: 'PAGE_ONLY', mode, cutoff: now, observed: consumed.length,
    counts, hasMore, nextCursor: hasMore ? {
      dueAt: dueAt as number, jobId: last.id,
    } : null,
    maxQueryReads: limit + 1,
    maxTransactionReads: mode === 'APPLY' ? consumed.length * 2 : 0,
    maxWrites: mode === 'APPLY' ? consumed.length : 0,
    provesGlobalCoverage: false,
  };
}
