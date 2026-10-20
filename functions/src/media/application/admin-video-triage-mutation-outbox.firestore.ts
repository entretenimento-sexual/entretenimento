/**
 * c18p staged, backend-only video processing mutation outbox.
 *
 * Only an explicit subset of job mutations is instrumented. There is NO
 * global sequence, no external writer census and NO production coverage proof.
 * The event is created by the caller's existing Firestore transaction.
 * Never call the Transcoder or perform a read from this helper.
 */
import { createHash } from 'node:crypto';

import {
  FieldValue, type DocumentReference, type DocumentSnapshot,
  type Firestore, type Transaction,
} from 'firebase-admin/firestore';

import {
  VIDEO_PROCESSING_JOBS_COLLECTION, type VideoProcessingJobState,
} from './video-processing-job';

export const VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION =
  'media_video_processing_mutation_events';

export const VIDEO_TRIAGE_MUTATION_OUTBOX_SCHEMA_VERSION = 1;

export type VideoTriageMutationSource =
  'ACCOUNT_DELETION_PAGE' | 'ACCOUNT_DELETION_PRIVATE_VIDEO' |
  'CANCELLATION_RECONCILIATION' | 'QUEUE_CREATION' |
  'SUBMISSION_CLAIM' | 'SUBMISSION_CONFIRMATION' | 'TERMINAL_COMMIT' |
  'ADMIN_RECOVERY' | 'SUBMISSION_RECOVERY' | 'SOURCE_PROBE' |
  'IMMUTABLE_PREFLIGHT' | 'EMULATOR_PROCESSING' |
  'PROFILE_VIDEO_DELETION';

export type VideoTriageMutationKind =
  'CANCEL_REQUESTED' | 'DELETE' | 'STATE_TRANSITION' | 'CREATE' |
  'VERSION_REPLACED';

export interface VideoTriageMutationIntent {
  eventId: string;
  source: VideoTriageMutationSource;
  kind: VideoTriageMutationKind;
  /** A validated, existing job snapshot read inside the same transaction. */
  before: DocumentSnapshot;
  /**
   * UPDATE: CANCEL_REQUESTED; DELETE: null. No arbitrary after-image data,
   * tokens, file paths, video metadata, owner UID or personal data.
   */
  afterState: VideoProcessingJobState | null;
  /** Version on a retry that replaces the processing attempt. */
  nextProcessingVersion?: string;
}

const VALID_STATES: ReadonlySet<string> = new Set([
  'QUEUED', 'SUBMITTING', 'PROCESSING', 'SUCCEEDED', 'FAILED',
  'CANCEL_REQUESTED', 'CANCELLED',
]);

function safeState(value: unknown): string {
  return typeof value === 'string' && /^[A-Z_]{1,40}$/.test(value) ?
    value : 'UNVERIFIED';
}

function safeVersion(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 128 &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

/** Stage one idempotency-identified event without any separate commit. */
export function stageVideoTriageMutationInTransaction(
  firestore: Firestore,
  transaction: Transaction,
  jobRef: DocumentReference,
  intent: VideoTriageMutationIntent
): void {
  if (jobRef.firestore !== firestore ||
      jobRef.parent.id !== VIDEO_PROCESSING_JOBS_COLLECTION ||
      !/^[a-f0-9-]{36}$/i.test(intent.eventId) ||
      !intent.before.exists ||
      intent.before.ref.path !== jobRef.path ||
      (intent.kind === 'DELETE' && intent.afterState !== null) ||
      (intent.kind === 'CANCEL_REQUESTED' &&
        intent.afterState !== 'CANCEL_REQUESTED') ||
      intent.kind === 'CREATE' ||
      (intent.kind === 'VERSION_REPLACED' &&
        (intent.source !== 'ADMIN_RECOVERY' ||
        intent.afterState !== 'QUEUED' ||
        !intent.nextProcessingVersion ||
        safeVersion(intent.nextProcessingVersion) !==
          intent.nextProcessingVersion ||
        intent.nextProcessingVersion === intent.before.get('processingVersion'))) ||
      (intent.kind !== 'VERSION_REPLACED' &&
        intent.nextProcessingVersion !== undefined) ||
      (intent.kind === 'STATE_TRANSITION' &&
        (!intent.afterState || !VALID_STATES.has(intent.afterState) ||
        intent.afterState === intent.before.get('state')))) {
    throw new Error('Invalid video job mutation outbox intent.');
  }

  const before = intent.before.data() as Record<string, unknown>;
  const ref = firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(intent.eventId);
  transaction.create(ref, {
    schemaVersion: VIDEO_TRIAGE_MUTATION_OUTBOX_SCHEMA_VERSION,
    scope: 'PARTIAL_WRITER_COVERAGE',
    source: intent.source,
    kind: intent.kind,
    jobKeySha256: createHash('sha256').update(jobRef.path).digest('hex'),
    previousState: safeState(before.state),
    nextState: intent.afterState,
    processingVersion: safeVersion(before.processingVersion),
    ...(intent.kind === 'VERSION_REPLACED'
      ? { nextProcessingVersion: intent.nextProcessingVersion } : {}),
    previousUpdateTime: intent.before.updateTime?.toMillis() ?? null,
    recordedAt: FieldValue.serverTimestamp(),
    // Claim is only that this event shares the caller's job transaction.
    globalCoverageVerified: false,
    globallySequenced: false,
  });
}


/**
 * Stage the QUEUED creation only after reading the absent job inside the
 * caller's transaction. No separate reads, retries or provider calls.
 */
export function stageVideoTriageCreatedJobInTransaction(
  firestore: Firestore,
  transaction: Transaction,
  jobRef: DocumentReference,
  before: DocumentSnapshot,
  eventId: string,
  processingVersion: string
): void {
  if (jobRef.firestore !== firestore ||
      jobRef.parent.id !== VIDEO_PROCESSING_JOBS_COLLECTION ||
      !/^[a-f0-9-]{36}$/i.test(eventId) ||
      before.exists || before.ref.path !== jobRef.path ||
      safeVersion(processingVersion) !== processingVersion) {
    throw new Error('Invalid video job creation outbox intent.');
  }
  const ref = firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(eventId);
  transaction.create(ref, {
    schemaVersion: VIDEO_TRIAGE_MUTATION_OUTBOX_SCHEMA_VERSION,
    scope: 'PARTIAL_WRITER_COVERAGE',
    source: 'QUEUE_CREATION',
    kind: 'CREATE',
    jobKeySha256: createHash('sha256').update(jobRef.path).digest('hex'),
    previousState: null,
    nextState: 'QUEUED',
    processingVersion,
    previousUpdateTime: null,
    recordedAt: FieldValue.serverTimestamp(),
    globalCoverageVerified: false,
    globallySequenced: false,
  });
}

/**
 * c18t deterministic OFFLINE budget/retention assessment. No Firestore reads,
 * cleanup permission, deployment flags, financial rates or job lifecycle
 * writes may depend on this diagnostic. Caller-supplied observations are not
 * certified billing or a complete writer feed.
 */
export interface VideoTriageOutboxCostObservation {
  scope: 'OFFLINE_EMULATOR_OR_MANUAL_REPORT';
  windowStartMs: number;
  windowEndMs: number;
  /** Count of new committed outbox event documents in this window. */
  newEventDocuments: number;
  /** Sampled, cumulative stored bytes; not billed storage size. */
  sampledStoredBytes: number;
  /** Count of event documents actually included in the byte sample. */
  sampledDocuments: number;
  /** Optional observation of total documents retained at window end. */
  retainedDocumentsAtEnd: number | null;
}

export interface VideoTriageOutboxBudgetLimits {
  /** Explicit, reviewable offline thresholds, not runtime write quotas. */
  maxNewEventDocuments: number;
  maxEventsPerHour: number;
  maxSampledStoredBytes: number;
  maxObservationHours: number;
}

export type VideoTriageOutboxBudgetStatus =
  'WITHIN_OFFLINE_THRESHOLDS' | 'EXCEEDS_OFFLINE_THRESHOLDS' |
  'MISSING_APPROVED_LIMITS' | 'INVALID_OBSERVATION';

export interface VideoTriageOutboxBudgetReport {
  scope: 'OFFLINE_ONLY';
  status: VideoTriageOutboxBudgetStatus;
  eventWritesObserved: number | null;
  eventsPerHourCeiling: number | null;
  sampledStoredBytes: number | null;
  /** This is NOT a certified Firestore invoice or usage calculation. */
  productionCostVerified: false;
  globalCoverageVerified: false;
  cleanupAuthorized: false;
  globalOrderingEnabled: false;
}

function nonNegativeSafe(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Explicit limits are compulsory. A green offline report never authorizes
 * retention expiry and must not block a cancellation or account deletion.
 */
export function assessVideoTriageOutboxCostWindow(
  observation: VideoTriageOutboxCostObservation,
  limits: VideoTriageOutboxBudgetLimits | null
): VideoTriageOutboxBudgetReport {
  const base = {
    scope: 'OFFLINE_ONLY' as const, eventWritesObserved: null,
    eventsPerHourCeiling: null, sampledStoredBytes: null,
    productionCostVerified: false as const,
    globalCoverageVerified: false as const,
    cleanupAuthorized: false as const, globalOrderingEnabled: false as const,
  };
  if (!observation ||
      observation.scope !== 'OFFLINE_EMULATOR_OR_MANUAL_REPORT' ||
      !Number.isSafeInteger(observation.windowStartMs) ||
      !Number.isSafeInteger(observation.windowEndMs) ||
      observation.windowStartMs <= 0 ||
      observation.windowEndMs <= observation.windowStartMs ||
      !nonNegativeSafe(observation.newEventDocuments) ||
      !nonNegativeSafe(observation.sampledStoredBytes) ||
      !nonNegativeSafe(observation.sampledDocuments) ||
      (observation.retainedDocumentsAtEnd !== null &&
       !nonNegativeSafe(observation.retainedDocumentsAtEnd)) ||
      (observation.retainedDocumentsAtEnd !== null &&
       observation.sampledDocuments > observation.retainedDocumentsAtEnd)) {
    return { ...base, status: 'INVALID_OBSERVATION' };
  }
  const duration = observation.windowEndMs - observation.windowStartMs;
  const rate = Math.ceil(observation.newEventDocuments * 3_600_000 / duration);
  if (!Number.isSafeInteger(rate)) {
    return { ...base, status: 'INVALID_OBSERVATION' };
  }
  const metrics = {
    ...base, eventWritesObserved: observation.newEventDocuments,
    eventsPerHourCeiling: rate, sampledStoredBytes: observation.sampledStoredBytes,
  };
  if (!limits ||
      !nonNegativeSafe(limits.maxNewEventDocuments) ||
      !nonNegativeSafe(limits.maxEventsPerHour) ||
      !nonNegativeSafe(limits.maxSampledStoredBytes) ||
      !Number.isSafeInteger(limits.maxObservationHours) ||
      limits.maxObservationHours < 1 || limits.maxObservationHours > 24) {
    return { ...metrics, status: 'MISSING_APPROVED_LIMITS' };
  }
  const outside = duration > limits.maxObservationHours * 3_600_000 ||
    observation.newEventDocuments > limits.maxNewEventDocuments ||
    rate > limits.maxEventsPerHour ||
    observation.sampledStoredBytes > limits.maxSampledStoredBytes;
  return {
    ...metrics,
    status: outside ? 'EXCEEDS_OFFLINE_THRESHOLDS' :
      'WITHIN_OFFLINE_THRESHOLDS',
  };
}

/**
 * Retention has no automated safe deletion path. A witnessed consumer
 * checkpoint is necessary but NOT sufficient: complete global writer proof,
 * verified history, legal retention, privacy and cost authorization remain
 * unavailable. A caller must never convert this into a destructive action.
 */
export function assessVideoTriageOutboxRetentionPrerequisites(
  evidence: {
    completeWriterCoverageVerified: boolean;
    immutableGlobalSequenceVerified: boolean;
    independentConsumerCheckpointVerified: boolean;
    tombstoneHorizonApproved: boolean;
    privacyAndLegalRetentionApproved: boolean;
  }
): {
  status: 'RETAIN_AND_REVIEW';
  cleanupAuthorized: false;
  productionCostVerified: false;
  globalCoverageVerified: false;
  globalOrderingEnabled: false;
  unresolvedRequirements: readonly string[];
} {
  const unresolvedRequirements = [
    ...(!evidence?.completeWriterCoverageVerified ?
      ['completeWriterCoverage'] : []),
    ...(!evidence?.immutableGlobalSequenceVerified ?
      ['immutableGlobalSequence'] : []),
    ...(!evidence?.independentConsumerCheckpointVerified ?
      ['independentConsumerCheckpoint'] : []),
    ...(!evidence?.tombstoneHorizonApproved ?
      ['tombstoneHorizon'] : []),
    ...(!evidence?.privacyAndLegalRetentionApproved ?
      ['privacyAndLegalRetention'] : []),
  ];
  return {
    status: 'RETAIN_AND_REVIEW', cleanupAuthorized: false,
    productionCostVerified: false, globalCoverageVerified: false,
    globalOrderingEnabled: false, unresolvedRequirements,
  };
}
