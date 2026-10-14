/**
 * Diagnostic summary from an existing bounded admin sample. These numbers
 * describe persisted backlog only, never actual Cloud Scheduler execution.
 */
export interface CancellationBacklogSample {
  state?: unknown;
  cancelRequestedAt?: unknown;
  nextAttemptAt?: unknown;
}

export interface CancellationBacklogDiagnostic {
  verification: 'UNVERIFIED';
  scheduleMinutes: 30;
  sampled: number;
  due: number;
  overdue24h: number;
  missingOrInvalidDue: number;
  samplePartial: boolean;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) && value >= 0;
}

export function summarizeCancellationBacklogSample(
  jobs: ReadonlyArray<CancellationBacklogSample>,
  now: number,
  totalCancellationJobs: number
): CancellationBacklogDiagnostic {
  let sampled = 0;
  let due = 0;
  let overdue24h = 0;
  let missingOrInvalidDue = 0;

  for (const job of jobs) {
    if (job.state !== 'CANCEL_REQUESTED') continue;
    sampled += 1;
    if (!isTimestamp(job.nextAttemptAt)) {
      missingOrInvalidDue += 1;
      continue;
    }
    if (job.nextAttemptAt > now) continue;
    due += 1;
    if (
      isTimestamp(job.cancelRequestedAt) &&
      job.cancelRequestedAt > 0 &&
      job.cancelRequestedAt <= now - 24 * 60 * 60_000
    ) {
      overdue24h += 1;
    }
  }

  return {
    verification: 'UNVERIFIED',
    scheduleMinutes: 30,
    sampled,
    due,
    overdue24h,
    missingOrInvalidDue,
    samplePartial: totalCancellationJobs > sampled,
  };
}
