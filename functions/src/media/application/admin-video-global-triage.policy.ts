/**
 * Preparatory admin triage projection, c18c. Pure functions; no Firestore reads,
 * mutations, provider calls or permission to retry, cancel or delete.
 *
 * A global index is unusable until every actionable record has a current,
 * version-fenced projection and time-triggered reclassification is maintained.
 */
import type { VideoProcessingJob, VideoProcessingJobState } from './video-processing-job';
import {
  isOverdueVideoCancellation,
  isUnconfirmedVideoSubmission,
  videoRecoveryRequiresProviderReview,
} from './admin-video-processing-recovery.policy';
import { isProviderPollReviewRequired } from './video-provider-poll-failure.policy';

export const VIDEO_TRIAGE_STALE_AFTER_MS: Partial<Record<VideoProcessingJobState, number>> = {
  QUEUED: 20 * 60_000,
  SUBMITTING: 20 * 60_000,
  PROCESSING: 3 * 60 * 60_000,
  CANCEL_REQUESTED: 90 * 60_000,
};

const ACTIONABLE = new Set<VideoProcessingJobState>([
  'FAILED', 'QUEUED', 'SUBMITTING', 'PROCESSING', 'CANCEL_REQUESTED',
]);

export type AdminTriageTimestampEvidence =
  'UPDATED' | 'CREATED_FALLBACK' | 'UNVERIFIED';
export type AdminTriageTier = 0 | 1 | 2 | 3 | 4 | 5;

export interface AdminTriageCandidate {
  jobId: string;
  state: VideoProcessingJobState;
  timestampEvidence: AdminTriageTimestampEvidence;
  updatedAt: number;
  ageMs: number;
  stale: boolean;
  requiresProviderReview: boolean;
  providerPollReviewRequired: boolean;
  requiresOperationalAttention: boolean;
  unconfirmedSubmission: boolean;
}

export interface AdminTriageKey {
  tier: AdminTriageTier;
  since: number;
  jobId: string;
}

export interface AdminTriageProjection {
  adminTriageProjectionVersion: 1;
  adminTriageProcessingVersion: string;
  adminTriageTier: AdminTriageTier;
  adminTriageSince: number;
  /** A scheduled re-evaluation deadline; indexing alone cannot update it. */
  adminTriageReevaluateAt: number | null;
}

function validTimestamp(value: unknown, now: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value > 0 && value <= now ? value : null;
}

/** Current ranking is a read-only diagnostic, not a processing decision. */
export function adminTriageKey(candidate: AdminTriageCandidate): AdminTriageKey {
  let tier: AdminTriageTier;
  if (candidate.requiresProviderReview || candidate.providerPollReviewRequired ||
      candidate.requiresOperationalAttention || candidate.unconfirmedSubmission) {
    tier = 0;
  } else if (candidate.timestampEvidence === 'UNVERIFIED') {
    tier = 1;
  } else if (candidate.state === 'FAILED') {
    tier = 2;
  } else if (candidate.stale) {
    tier = 3;
  } else if (candidate.timestampEvidence === 'CREATED_FALLBACK') {
    tier = 4;
  } else {
    tier = 5;
  }
  // ASC: oldest first within a severity lane, unknown timestamps are never
  // presented as age zero / fresh. IDs are the stable final tie-breaker.
  const since = candidate.timestampEvidence === 'UNVERIFIED' ? 0 :
    candidate.updatedAt;
  return { tier, since, jobId: candidate.jobId };
}

export function compareAdminTriageJobs(
  left: AdminTriageCandidate,
  right: AdminTriageCandidate
): number {
  const a = adminTriageKey(left);
  const b = adminTriageKey(right);
  return a.tier - b.tier || a.since - b.since ||
    (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0);
}

/**
 * Projection prototype for eventual transactional writers/backfill.
 * DO NOT persist this independently of a version-fenced state transition.
 */
export function projectAdminTriageJob(
  jobId: string,
  job: Partial<VideoProcessingJob>,
  now: number
): AdminTriageProjection | null {
  if (!job.state || !ACTIONABLE.has(job.state) ||
      typeof job.processingVersion !== 'string' ||
      !job.processingVersion.trim() || !Number.isSafeInteger(now) || now <= 0) {
    return null;
  }
  const updated = validTimestamp(job.updatedAt, now);
  const created = validTimestamp(job.createdAt, now);
  const since = updated ?? created ?? 0;
  const evidence: AdminTriageTimestampEvidence = updated !== null ? 'UPDATED' :
    created !== null ? 'CREATED_FALLBACK' : 'UNVERIFIED';
  const staleAfter = VIDEO_TRIAGE_STALE_AFTER_MS[job.state];
  const stale = staleAfter !== undefined && since > 0 &&
    now - since > staleAfter;
  const candidate: AdminTriageCandidate = {
    jobId,
    state: job.state,
    timestampEvidence: evidence,
    updatedAt: since,
    ageMs: since > 0 ? now - since : 0,
    stale,
    requiresProviderReview: videoRecoveryRequiresProviderReview(job),
    providerPollReviewRequired: isProviderPollReviewRequired(job),
    requiresOperationalAttention: isOverdueVideoCancellation(job, now),
    unconfirmedSubmission: isUnconfirmedVideoSubmission(job),
  };
  const key = adminTriageKey(candidate);
  const nextChecks: number[] = [];
  if (staleAfter !== undefined && since > 0 && !stale) {
    const deadline = since + staleAfter + 1;
    if (Number.isSafeInteger(deadline) && deadline > now) nextChecks.push(deadline);
  }
  if (job.state === 'CANCEL_REQUESTED' &&
      validTimestamp(job.cancelRequestedAt, now) !== null &&
      typeof job.nextAttemptAt === 'number' &&
      Number.isSafeInteger(job.nextAttemptAt)) {
    const deadline = (job.cancelRequestedAt as number) + 24 * 60 * 60_000;
    if (Number.isSafeInteger(deadline)) {
      const due = Math.max(deadline, job.nextAttemptAt);
      if (due > now) nextChecks.push(due);
    }
  }
  return {
    adminTriageProjectionVersion: 1,
    adminTriageProcessingVersion: job.processingVersion,
    adminTriageTier: key.tier,
    adminTriageSince: key.since,
    adminTriageReevaluateAt: nextChecks.length ? Math.min(...nextChecks) : null,
  };
}

/**
 * Activation cannot be inferred from a committed index declaration or a
 * partial page audit. Only independently verified global evidence qualifies.
 */
export interface AdminTriageActivationEvidence {
  deployedIndexReady: boolean;
  allActionableProjected: boolean;
  legacyCoverageVerified: boolean;
  writerVersionFencingVerified: boolean;
  dynamicReevaluationVerified: boolean;
  terminalDocumentsExcluded: boolean;
  concurrentCursorSafetyVerified: boolean;
  boundedReadBudgetVerified: boolean;
  globallyConsistentAuditVerified: boolean;
}

export function assessAdminTriageActivation(
  evidence: AdminTriageActivationEvidence
): { ready: boolean; blockedBy: (keyof AdminTriageActivationEvidence)[] } {
  const keys = Object.keys(evidence) as (keyof AdminTriageActivationEvidence)[];
  const blockedBy = keys.filter(key => evidence[key] !== true);
  return { ready: blockedBy.length === 0, blockedBy };
}
