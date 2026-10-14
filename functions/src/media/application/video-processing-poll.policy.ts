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

/**
 * A poll result belongs to one atomic nextAttemptAt reservation. Another
 * scheduler may reserve the same processing version before the response
 * arrives, so version and provider ID alone are not sufficient fencing.
 */
export function isCurrentVideoProcessingAttempt(
  current: Pick<VideoProcessingJob,
    'state' | 'processingVersion' | 'externalJobName' | 'nextAttemptAt'
  >,
  observed: Pick<VideoProcessingJob,
    'processingVersion' | 'externalJobName' | 'nextAttemptAt'
  >
): boolean {
  return current.state === 'PROCESSING' &&
    current.processingVersion === observed.processingVersion &&
    current.externalJobName === observed.externalJobName &&
    current.nextAttemptAt === observed.nextAttemptAt;
}

/**
 * Cleanups may complete after the owner retries the video with a new
 * processingVersion. Never delete the newer job with an older callback.
 */
export function isCurrentVideoCancellation(
  current: Pick<VideoProcessingJob, 'state' | 'processingVersion'> | null,
  started: Pick<VideoProcessingJob, 'processingVersion'>
): boolean {
  return current?.state === 'CANCEL_REQUESTED' &&
    current.processingVersion === started.processingVersion;
}
