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

export type VideoTriageMutationSource =
  'ACCOUNT_DELETION_PAGE' | 'ACCOUNT_DELETION_PRIVATE_VIDEO' |
  'CANCELLATION_RECONCILIATION' | 'QUEUE_CREATION' |
  'SUBMISSION_CLAIM' | 'SUBMISSION_CONFIRMATION' | 'TERMINAL_COMMIT' |
  'ADMIN_RECOVERY' | 'SUBMISSION_RECOVERY';

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
    schemaVersion: 1,
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
    schemaVersion: 1,
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
