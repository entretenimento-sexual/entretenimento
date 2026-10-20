/**
 * c18h two bounded reads in one lane: observations vs. re-read changes.
 * This does NOT guarantee snapshot isolation, cross-lane coverage or global
 * cursor correctness. Never mutates job or media content.
 */
import {
  FieldPath, type DocumentSnapshot, type Firestore,
} from 'firebase-admin/firestore';
import {
  VIDEO_PROCESSING_JOBS_COLLECTION, type VideoProcessingJob,
} from './video-processing-job';
import {
  VIDEO_TRIAGE_BACKFILL_MAX_PAGE, VIDEO_TRIAGE_BACKFILL_STATES,
  type VideoTriageBackfillState,
} from './admin-video-triage-backfill.firestore';
import {
  auditVideoTriageIntegrity, type VideoTriageIntegrity,
} from './admin-video-triage-consistency.firestore';

export interface VideoTriageConcurrentAuditRequest {
  state: VideoTriageBackfillState;
  afterId?: string | null;
  limit?: number;
  now?: number;
}
export interface VideoTriageConcurrentAuditPage {
  scope: 'PAGE_ONLY';
  consistency: 'BEST_EFFORT_NOT_SNAPSHOT';
  state: VideoTriageBackfillState;
  checkedAt: number;
  observed: number;
  stableOnReread: number;
  changedOnReread: number;
  removedOnReread: number;
  /** State transitions observed by the second read; not all lane moves. */
  movedOnReread: number;
  counts: Record<VideoTriageIntegrity, number>;
  hasMore: boolean;
  nextCursor: string | null;
  maxQueryReads: number;
  maxPointReads: number;
  maxDocumentReads: number;
  maxWrites: 0;
  provesGlobalCoverage: false;
  concurrentCursorSafetyVerified: false;
}

/**
 * Optional c18m emulator-only SDK-call observation. Returned document count
 * is measured after query completion; this is NOT Firestore billing evidence.
 * IDs stay inside the isolated test process and must never enter logs.
 */
export interface VideoTriagePageReadObservation {
  scope: 'EMULATOR_SDK_PAGE';
  state: VideoTriageBackfillState;
  afterId: string | null;
  ids: readonly string[];
  queryGetCalls: 1;
  queryDocumentsReturned: number;
  pointGetAllCalls: 0 | 1;
  pointDocumentsRequested: number;
  hasMore: boolean;
  nextCursor: string | null;
}

function identical(first: DocumentSnapshot, second: DocumentSnapshot): boolean {
  return first.exists && second.exists &&
    !!first.updateTime && !!second.updateTime &&
    first.updateTime.isEqual(second.updateTime) &&
    first.get('state') === second.get('state') &&
    first.get('processingVersion') === second.get('processingVersion');
}

export async function auditVideoTriageConcurrentPage(
  db: Firestore, request: VideoTriageConcurrentAuditRequest,
  observe?: (result: VideoTriagePageReadObservation) => void
): Promise<VideoTriageConcurrentAuditPage> {
  // Never expose diagnostic IDs or SDK metrics outside the local emulator.
  if (observe && (!/^127\\.0\\.0\\.1:\\d{2,5}$/.test(
    process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
    db.databaseId !== '(default)')) {
    throw new Error('Triage SDK observation requires local Firestore Emulator.');
  }
  const now = request.now ?? Date.now();
  const limit = request.limit ?? 10;
  if (!VIDEO_TRIAGE_BACKFILL_STATES.includes(request.state) ||
      !Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 || limit > VIDEO_TRIAGE_BACKFILL_MAX_PAGE ||
      (request.afterId != null &&
        !/^[A-Za-z0-9_-]{1,257}$/.test(request.afterId))) {
    throw new RangeError('Invalid video triage audit page request.');
  }
  let query = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('state', '==', request.state)
    .orderBy(FieldPath.documentId());
  if (request.afterId) query = query.startAfter(request.afterId);
  const docs = (await query.limit(limit + 1).get()).docs;
  const consumed = docs.slice(0, limit);
  const counts: Record<VideoTriageIntegrity, number> = {
    CURRENT: 0, MISSING_PROJECTION: 0, STALE_VERSION: 0,
    DIVERGENT: 0, TIME_DUE: 0, TERMINAL_RESIDUE: 0,
    UNVERSIONED: 0, TERMINAL_CLEAR: 0,
  };
  for (const doc of consumed) {
    counts[auditVideoTriageIntegrity(doc.id,
      doc.data() as Partial<VideoProcessingJob>, now)]++;
  }
  const current = consumed.length ?
    await db.getAll(...consumed.map(doc => doc.ref)) : [];
  let stableOnReread = 0;
  let changedOnReread = 0;
  let removedOnReread = 0;
  let movedOnReread = 0;
  for (let i = 0; i < consumed.length; i++) {
    if (!current[i]?.exists) removedOnReread++;
    else if (identical(consumed[i], current[i])) stableOnReread++;
    else {
      changedOnReread++;
      if (current[i].get('state') !== request.state) movedOnReread++;
    }
  }
  const hasMore = docs.length > limit;
  if (observe) {
    observe({
      scope: 'EMULATOR_SDK_PAGE', state: request.state,
      afterId: request.afterId ?? null,
      ids: consumed.map(doc => doc.id),
      queryGetCalls: 1, queryDocumentsReturned: docs.length,
      pointGetAllCalls: consumed.length ? 1 : 0,
      pointDocumentsRequested: consumed.length,
      hasMore, nextCursor: hasMore ? consumed[consumed.length - 1].id : null,
    });
  }
  return {
    scope: 'PAGE_ONLY', consistency: 'BEST_EFFORT_NOT_SNAPSHOT',
    state: request.state, checkedAt: now, observed: consumed.length,
    stableOnReread, changedOnReread, removedOnReread,
    movedOnReread, counts, hasMore,
    nextCursor: hasMore ? consumed[consumed.length - 1].id : null,
    maxQueryReads: limit + 1, maxPointReads: consumed.length,
    maxDocumentReads: limit + 1 + consumed.length,
    maxWrites: 0, provesGlobalCoverage: false,
    concurrentCursorSafetyVerified: false,
  };
}
