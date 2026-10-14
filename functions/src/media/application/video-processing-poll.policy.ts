import type { VideoProcessingJob } from './video-processing-job';

// Scheduler runs every five minutes. Due times precede the target 10/15min
// slots to tolerate normal scheduling jitter. A 9min minimum spacing
// prevents overlapping 540-second scheduled invocations for the same job.
const RECENT_POLL_DELAY_MS = 9 * 60_000;
const LONG_POLL_DELAY_MS = 14 * 60_000;
const LONG_RUNNING_AFTER_MS = 30 * 60_000;

export function nextVideoProcessingPollAt(
  job: Pick<VideoProcessingJob, 'submittedAt' | 'createdAt'>,
  now: number
): number {
  const submittedAt = job.submittedAt ?? job.createdAt;
  const ageMs = Math.max(0, now - submittedAt);
  return now + (
    ageMs >= LONG_RUNNING_AFTER_MS
      ? LONG_POLL_DELAY_MS
      : RECENT_POLL_DELAY_MS
  );
}

export function providerObservationChanged(
  job: Pick<VideoProcessingJob, 'providerState' | 'lastErrorCode' | 'lastError'>,
  providerState: string
): boolean {
  return job.providerState !== providerState ||
    job.lastErrorCode !== null ||
    job.lastError !== null;
}

export function isCurrentVideoProcessingAttempt(
  current: Pick<VideoProcessingJob, 'state' | 'processingVersion' | 'externalJobName'>,
  observed: Pick<VideoProcessingJob, 'processingVersion' | 'externalJobName'>
): boolean {
  return current.state === 'PROCESSING' &&
    current.processingVersion === observed.processingVersion &&
    current.externalJobName === observed.externalJobName;
}
