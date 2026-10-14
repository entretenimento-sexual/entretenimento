import type { VideoCancellationResult } from './video-cancellation-execution';

export interface CancellationCycleMetrics {
  selected: number;
  claimed: number;
  invalid: number;
  claimSkipped: number;
  batchLimitReached: boolean;
  completed: number;
  retryScheduled: number;
  unconfirmed: number;
  replaced: number;
  taskRejected: number;
  durationMs: number;
}

/** Safe, bounded, identifier-free counters for one Cloud Scheduler invocation. */
export function summarizeCancellationCycle(
  selected: number,
  claimed: number,
  invalid: number,
  batchLimit: number,
  results: PromiseSettledResult<VideoCancellationResult>[],
  elapsedMs: number
): CancellationCycleMetrics {
  const metrics: CancellationCycleMetrics = {
    selected,
    claimed,
    invalid,
    claimSkipped: Math.max(0, selected - claimed - invalid),
    batchLimitReached: selected >= batchLimit,
    completed: 0,
    retryScheduled: 0,
    unconfirmed: 0,
    replaced: 0,
    taskRejected: 0,
    durationMs: Number.isFinite(elapsedMs)
      ? Math.max(0, Math.floor(elapsedMs)) : 0,
  };

  for (const result of results) {
    if (result.status === 'rejected') {
      metrics.taskRejected += 1;
      continue;
    }

    switch (result.value.status) {
      case 'COMPLETED':
        metrics.completed += 1;
        break;
      case 'RETRY_SCHEDULED':
        metrics.retryScheduled += 1;
        break;
      case 'UNCONFIRMED':
        metrics.unconfirmed += 1;
        break;
      case 'REPLACED':
        metrics.replaced += 1;
        break;
    }
  }

  return metrics;
}

export function cancellationCycleNeedsAttention(
  metrics: CancellationCycleMetrics
): boolean {
  return metrics.invalid > 0 || metrics.unconfirmed > 0 ||
    metrics.retryScheduled > 0 || metrics.taskRejected > 0;
}
