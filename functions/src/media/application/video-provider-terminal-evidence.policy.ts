/**
 * A terminal state is trusted only after a successful Transcoder GET for the
 * exact external job and processing version. HTTP errors are NOT observations.
 */
import type { GoogleTranscoderJobSnapshot } from './google-video-transcoder.service';
import type {
  VideoProcessingJob,
  VideoProviderTerminalEvidence,
} from './video-processing-job';

export function buildProviderTerminalEvidence(
  job: Pick<VideoProcessingJob, 'processingVersion' | 'externalJobName'>,
  observed: Pick<GoogleTranscoderJobSnapshot, 'name' | 'state'>,
  now: number
): VideoProviderTerminalEvidence {
  if (
    !job.externalJobName ||
    observed.name !== job.externalJobName ||
    (observed.state !== 'SUCCEEDED' && observed.state !== 'FAILED') ||
    !job.processingVersion ||
    !Number.isSafeInteger(now) ||
    now <= 0
  ) {
    throw new Error('VIDEO_PROVIDER_TERMINAL_EVIDENCE_MISMATCH');
  }
  return {
    processingVersion: job.processingVersion,
    externalJobName: job.externalJobName,
    state: observed.state,
    observedAt: now,
  };
}

export function matchesProviderTerminalEvidence(
  job: Pick<VideoProcessingJob,
    'processingVersion' | 'externalJobName' | 'state' |
    'providerState' | 'providerTerminalEvidence'>
): boolean {
  const proof = job.providerTerminalEvidence;
  return !!job.externalJobName && !!proof &&
    (job.state === 'SUCCEEDED' || job.state === 'FAILED') &&
    job.providerState === job.state &&
    proof.processingVersion === job.processingVersion &&
    proof.externalJobName === job.externalJobName &&
    proof.state === job.state &&
    Number.isSafeInteger(proof.observedAt) &&
    proof.observedAt > 0;
}
