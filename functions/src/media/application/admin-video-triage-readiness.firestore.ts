/**
 * c18g offline manual preflight: one state lane and one due-deadline sample.
 * These two queries never imply production index READY or global coverage.
 * No scheduler, callable, provider calls, write or autonomous continuation.
 */
import type { Firestore } from 'firebase-admin/firestore';
import {
  auditVideoTriageIntegrityPage, reclassifyDueVideoTriagePage,
  type VideoTriageIntegrityPage, type VideoTriageDuePage,
} from './admin-video-triage-consistency.firestore';
import {
  VIDEO_TRIAGE_BACKFILL_STATES, VIDEO_TRIAGE_BACKFILL_MAX_PAGE,
  type VideoTriageBackfillState,
} from './admin-video-triage-backfill.firestore';
import {
  evaluateVideoTriageReadiness,
  type VideoTriageReadinessResult,
} from './admin-video-triage-readiness.policy';

export interface VideoTriageReadinessProbeRequest {
  state: VideoTriageBackfillState;
  afterId?: string | null;
  limit?: number;
  now?: number;
}

export interface VideoTriageReadinessProbeResult {
  scope: 'PAGE_ONLY';
  stateAudit: VideoTriageIntegrityPage;
  deadlineSample: VideoTriageDuePage;
  /** Summed ceiling: (limit + 1) + (1 + 1). */
  maxQueryReads: number;
  maxTransactionReads: 0;
  maxWrites: 0;
  /** Sampling is never proof of a READY production index. */
  provesGlobalCoverage: false;
  /** With no independent evidence, nine readiness requirements stay blocked. */
  readiness: VideoTriageReadinessResult;
}

export async function sampleVideoTriageReadinessPage(
  db: Firestore, request: VideoTriageReadinessProbeRequest
): Promise<VideoTriageReadinessProbeResult> {
  const limit = request.limit ?? 10;
  const now = request.now ?? Date.now();
  if (!VIDEO_TRIAGE_BACKFILL_STATES.includes(request.state) ||
      !Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > VIDEO_TRIAGE_BACKFILL_MAX_PAGE) {
    throw new RangeError('Invalid video triage readiness page request.');
  }
  // If the due-index query fails (e.g. missing index), propagate that error;
  // never convert it to zero pending jobs or a successful readiness result.
  const stateAudit = await auditVideoTriageIntegrityPage(db, {
    state: request.state, afterId: request.afterId, limit, now,
  });
  const deadlineSample = await reclassifyDueVideoTriagePage(db, {
    now, limit: 1, mode: 'DRY_RUN',
  });
  return {
    scope: 'PAGE_ONLY', stateAudit, deadlineSample,
    maxQueryReads: stateAudit.maxQueryReads + deadlineSample.maxQueryReads,
    maxTransactionReads: 0, maxWrites: 0,
    provesGlobalCoverage: false,
    readiness: evaluateVideoTriageReadiness(null, now),
  };
}
