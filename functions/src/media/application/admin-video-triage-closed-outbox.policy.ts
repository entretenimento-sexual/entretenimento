/**
 * c18x-B4: read-only reconciliation of explicitly fenced Emulator epochs.
 * A test-owned, independent committed-write manifest is mandatory: the
 * current job state alone cannot prove that a historical event is missing.
 * Never infer production coverage, sequencing, billing, or deletion authority.
 */
import type {
  VideoTriageMutationKind, VideoTriageMutationSource,
} from './admin-video-triage-mutation-outbox.firestore';

type State = 'QUEUED' | 'SUBMITTING' | 'PROCESSING' | 'SUCCEEDED' |
  'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED' | null;

export interface ClosedOutboxEventWitness {
  id: string;
  jobKeySha256: string;
  source: VideoTriageMutationSource;
  kind: VideoTriageMutationKind;
  previousState: State;
  nextState: State;
  processingVersion: string | null;
  nextProcessingVersion?: string;
}

export interface ClosedOutboxJobWitness {
  jobKeySha256: string;
  initialState: State;
  initialVersion: string | null;
}

export interface ClosedOutboxEpochWitness {
  scope: 'FENCED_EMULATOR_EPOCH';
  openedAt: number;
  closedAt: number;
  allWritersStopped: boolean;
  allScopedEventsRead: boolean;
  allScopedJobsRead: boolean;
  jobs: readonly ClosedOutboxJobWitness[];
  /** An independently recorded list, in actual commit order per job. */
  committed: readonly ClosedOutboxEventWitness[];
}

export interface ClosedOutboxObservedEvent {
  id: string;
  fields: Record<string, unknown>;
}

export interface ClosedOutboxObservedJob {
  jobKeySha256: string;
  state: State;
  processingVersion: string | null;
}

export interface ClosedOutboxReport {
  scope: 'EMULATOR_CLOSED_OUTBOX_ONLY';
  status: 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE';
  issues: readonly string[];
  expectedEvents: number;
  observedEvents: number;
  missingEvents: number;
  unexpectedEvents: number;
  payloadMismatches: number;
  finalJobMismatches: number;
  globalCoverageVerified: false;
  globallySequenced: false;
  productionCostVerified: false;
  cleanupAuthorized: false;
}

const STATES = new Set<unknown>([
  null, 'QUEUED', 'SUBMITTING', 'PROCESSING', 'SUCCEEDED',
  'FAILED', 'CANCEL_REQUESTED', 'CANCELLED',
]);
const VERSION = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/i;
const MAX_JOBS = 16;
const MAX_EVENTS = 64;

function version(value: unknown): boolean {
  return value === null || (typeof value === 'string' && VERSION.test(value));
}

function signature(fields: Record<string, unknown>): string {
  return JSON.stringify([
    fields['jobKeySha256'], fields['source'], fields['kind'],
    fields['previousState'], fields['nextState'],
    fields['processingVersion'], fields['nextProcessingVersion'] ?? null,
    fields['previousUpdateTime'] ?? null,
  ]);
}

export function reconcileClosedVideoTriageOutbox(
  epoch: ClosedOutboxEpochWitness,
  observedEvents: readonly ClosedOutboxObservedEvent[],
  observedJobs: readonly ClosedOutboxObservedJob[]
): ClosedOutboxReport {
  const problems = new Set<string>();
  let missingEvents = 0;
  let unexpectedEvents = 0;
  let payloadMismatches = 0;
  let finalJobMismatches = 0;
  const report = (status: ClosedOutboxReport['status']): ClosedOutboxReport => ({
    scope: 'EMULATOR_CLOSED_OUTBOX_ONLY',
    status, issues: [...problems].sort(),
    expectedEvents: epoch?.committed?.length ?? 0,
    observedEvents: observedEvents?.length ?? 0,
    missingEvents, unexpectedEvents, payloadMismatches, finalJobMismatches,
    globalCoverageVerified: false, globallySequenced: false,
    productionCostVerified: false, cleanupAuthorized: false,
  });
  if (!epoch || epoch.scope !== 'FENCED_EMULATOR_EPOCH' ||
      epoch.allWritersStopped !== true ||
      epoch.allScopedEventsRead !== true ||
      epoch.allScopedJobsRead !== true ||
      !Number.isSafeInteger(epoch.openedAt) || epoch.openedAt <= 0 ||
      !Number.isSafeInteger(epoch.closedAt) ||
      epoch.closedAt < epoch.openedAt) {
    problems.add('EPOCH_NOT_CLOSED');
    return report('INCONCLUSIVE');
  }
  if (!Array.isArray(epoch.jobs) || !Array.isArray(epoch.committed) ||
      !Array.isArray(observedEvents) || !Array.isArray(observedJobs) ||
      epoch.jobs.length > MAX_JOBS || epoch.committed.length > MAX_EVENTS ||
      observedEvents.length > MAX_EVENTS || observedJobs.length > MAX_JOBS) {
    problems.add('UNBOUNDED_OR_INVALID_INPUT');
    return report('INCONCLUSIVE');
  }

  const state = new Map<string, { state: State; version: string | null }>();
  const expectedIds = new Set<string>();
  for (const job of epoch.jobs) {
    if (!job || !HASH.test(job.jobKeySha256) ||
        !STATES.has(job.initialState) || !version(job.initialVersion) ||
        (job.initialState === null) !== (job.initialVersion === null) ||
        state.has(job.jobKeySha256)) {
      problems.add('INVALID_JOB_MANIFEST');
      return report('INCONCLUSIVE');
    }
    state.set(job.jobKeySha256, {
      state: job.initialState, version: job.initialVersion,
    });
  }

  // Replay the independent writer manifest, not the event content. This
  // validates the per-job chain without claiming a global transaction order.
  for (const event of epoch.committed) {
    if (!event || !UUID.test(event.id) || expectedIds.has(event.id) ||
        !HASH.test(event.jobKeySha256) || !state.has(event.jobKeySha256) ||
        !STATES.has(event.previousState) || !STATES.has(event.nextState) ||
        !version(event.processingVersion) ||
        (event.nextProcessingVersion !== undefined &&
          (typeof event.nextProcessingVersion !== 'string' ||
            !VERSION.test(event.nextProcessingVersion)))) {
      problems.add('INVALID_COMMIT_MANIFEST');
      return report('INCONCLUSIVE');
    }
    const previous = state.get(event.jobKeySha256)!;
    if (previous.state !== event.previousState ||
        (event.kind !== 'CREATE' &&
          previous.version !== event.processingVersion)) {
      problems.add('INVALID_COMMIT_CHAIN');
      return report('INCONCLUSIVE');
    }
    const creating = event.kind === 'CREATE' &&
      previous.state === null && event.previousState === null &&
      event.nextState === 'QUEUED' && event.processingVersion !== null;
    const replacing = event.kind === 'VERSION_REPLACED' &&
      event.source === 'ADMIN_RECOVERY' &&
      event.nextState === 'QUEUED' &&
      event.nextProcessingVersion !== undefined &&
      event.nextProcessingVersion !== previous.version &&
      previous.state !== null;
    const transition = event.kind === 'STATE_TRANSITION' &&
      event.nextState !== null && event.previousState !== null &&
      event.nextState !== event.previousState;
    const cancelling = event.kind === 'CANCEL_REQUESTED' &&
      event.previousState !== null &&
      event.previousState !== 'CANCEL_REQUESTED' &&
      event.nextState === 'CANCEL_REQUESTED';
    const deleting = event.kind === 'DELETE' &&
      event.previousState !== null && event.nextState === null;
    if (!(creating || replacing || transition || cancelling || deleting) ||
        (event.kind !== 'VERSION_REPLACED' &&
          event.nextProcessingVersion !== undefined)) {
      problems.add('INVALID_COMMIT_SEMANTICS');
      return report('INCONCLUSIVE');
    }
    expectedIds.add(event.id);
    state.set(event.jobKeySha256, {
      state: event.nextState,
      version: creating ? event.processingVersion :
        replacing ? event.nextProcessingVersion! :
          deleting ? null : previous.version,
    });
  }

  const actual = new Map<string, ClosedOutboxObservedEvent>();
  const signatures = new Map<string, string>();
  for (const event of observedEvents) {
    if (!event || !UUID.test(event.id) || !event.fields ||
        typeof event.fields !== 'object' || actual.has(event.id)) {
      problems.add('INVALID_OBSERVED_EVENT_SET');
      return report('INCONCLUSIVE');
    }
    actual.set(event.id, event);
    const s = signature(event.fields);
    if (signatures.has(s)) problems.add('DUPLICATE_LOGICAL_EVENT');
    else signatures.set(s, event.id);
    if (!expectedIds.has(event.id)) {
      unexpectedEvents += 1;
      problems.add('UNEXPECTED_EVENT');
    }
  }
  for (const expected of epoch.committed) {
    const entry = actual.get(expected.id);
    if (!entry) {
      missingEvents += 1;
      problems.add('MISSING_EVENT');
      continue;
    }
    const data = entry.fields;
    if (data['schemaVersion'] !== 1 ||
        data['scope'] !== 'PARTIAL_WRITER_COVERAGE' ||
        data['globalCoverageVerified'] !== false ||
        data['globallySequenced'] !== false ||
        data['jobKeySha256'] !== expected.jobKeySha256 ||
        data['source'] !== expected.source ||
        data['kind'] !== expected.kind ||
        data['previousState'] !== expected.previousState ||
        data['nextState'] !== expected.nextState ||
        data['processingVersion'] !== expected.processingVersion ||
        (data['nextProcessingVersion'] ?? undefined) !==
          expected.nextProcessingVersion) {
      payloadMismatches += 1;
      problems.add('EVENT_PAYLOAD_MISMATCH');
    }
  }

  const final = new Map<string, ClosedOutboxObservedJob>();
  for (const job of observedJobs) {
    if (!job || !HASH.test(job.jobKeySha256) ||
        !STATES.has(job.state) || !version(job.processingVersion) ||
        final.has(job.jobKeySha256)) {
      problems.add('INVALID_OBSERVED_JOB_SET');
      return report('INCONCLUSIVE');
    }
    final.set(job.jobKeySha256, job);
  }
  for (const [hash, expected] of state) {
    const current = final.get(hash);
    if (!current || current.state !== expected.state ||
        current.processingVersion !== expected.version) {
      finalJobMismatches += 1;
      problems.add('FINAL_JOB_MISMATCH');
    }
  }
  if ([...final.keys()].some(hash => !state.has(hash))) {
    problems.add('UNEXPECTED_JOB');
  }
  return report(problems.size ? 'DIVERGENT' : 'RECONCILED');
}
