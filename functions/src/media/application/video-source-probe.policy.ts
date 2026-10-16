import type { VideoProcessingJob } from './video-processing-job';
import type { AuthoritativeVideoProbeResult } from './video-rotation-worker.service';

export interface VideoSourceProbeSnapshot extends AuthoritativeVideoProbeResult {
  readonly processingVersion: string;
  readonly sourceStoragePath: string;
  readonly checkedAt: number;
}

/** Only server-validated source metadata, never client-supplied dimensions. */
export function createVideoSourceProbeSnapshot(
  job: Pick<VideoProcessingJob,
    'processingVersion' | 'sourceStoragePath' | 'sourceGeneration' | 'sourceSizeBytes'>,
  value: AuthoritativeVideoProbeResult,
  now: number
): VideoSourceProbeSnapshot {
  if (value.sourceGeneration !== job.sourceGeneration ||
      value.sourceSizeBytes !== job.sourceSizeBytes) {
    throw new VideoSourceProbeFailure('VIDEO_PROBE_SOURCE_CHANGED', false);
  }
  if (!Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(value.widthPixels) ||
      !Number.isSafeInteger(value.heightPixels) ||
      value.widthPixels < 2 || value.heightPixels < 2 ||
      value.widthPixels > 16_384 || value.heightPixels > 16_384 ||
      !Number.isSafeInteger(value.durationMs) ||
      value.durationMs < 5_000 || value.durationMs > 86_400_000 ||
      ![0, 90, 180, 270].includes(value.embeddedRotationDegrees) ||
      typeof value.hasAudio !== 'boolean' ||
      !/^[a-z0-9_]{1,40}$/.test(value.videoCodec) ||
      (value.audioCodec !== null && !/^[a-z0-9_]{1,40}$/.test(value.audioCodec)) ||
      !Number.isSafeInteger(value.displayAspectNumerator) ||
      !Number.isSafeInteger(value.displayAspectDenominator) ||
      value.displayAspectNumerator <= 0 || value.displayAspectDenominator <= 0 ||
      !Number.isSafeInteger(value.sampleAspectRatio?.numerator) ||
      !Number.isSafeInteger(value.sampleAspectRatio?.denominator) ||
      value.sampleAspectRatio.numerator <= 0 ||
      value.sampleAspectRatio.denominator <= 0) {
    throw new VideoSourceProbeFailure('VIDEO_PROBE_INVALID_RESPONSE', true);
  }
  return {
    processingVersion: job.processingVersion,
    sourceStoragePath: job.sourceStoragePath,
    sourceGeneration: value.sourceGeneration,
    sourceSizeBytes: value.sourceSizeBytes,
    widthPixels: value.widthPixels,
    heightPixels: value.heightPixels,
    durationMs: value.durationMs,
    embeddedRotationDegrees: value.embeddedRotationDegrees,
    displayAspectNumerator: value.displayAspectNumerator,
    displayAspectDenominator: value.displayAspectDenominator,
    sampleAspectRatio: {
      numerator: value.sampleAspectRatio.numerator,
      denominator: value.sampleAspectRatio.denominator,
    },
    videoCodec: value.videoCodec,
    hasAudio: value.hasAudio,
    audioCodec: value.audioCodec,
    checkedAt: now,
  };
}

export function matchesVideoSourceProbeSnapshot(
  job: Pick<VideoProcessingJob,
    'processingVersion' | 'sourceStoragePath' | 'sourceGeneration' | 'sourceSizeBytes'>,
  snapshot: unknown
): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const probe = snapshot as Partial<VideoSourceProbeSnapshot>;
  if (probe.processingVersion !== job.processingVersion ||
      probe.sourceStoragePath !== job.sourceStoragePath ||
      probe.sourceGeneration !== job.sourceGeneration ||
      probe.sourceSizeBytes !== job.sourceSizeBytes) return false;
  try {
    createVideoSourceProbeSnapshot(job, probe as AuthoritativeVideoProbeResult,
      Number(probe.checkedAt));
    return true;
  } catch {
    return false;
  }
}

export class VideoSourceProbeFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(code);
    this.name = 'VideoSourceProbeFailure';
  }
}

const PERMANENT_CODES = new Set([
  'VIDEO_PROBE_SOURCE_NOT_FOUND',
  'VIDEO_PROBE_GENERATION_MISMATCH',
  'VIDEO_PROBE_SOURCE_CHANGED',
  'VIDEO_PROBE_INVALID_MEDIA',
  'VIDEO_PROBE_NO_VIDEO_STREAM',
  'VIDEO_PROBE_INVALID_DIMENSIONS',
  'VIDEO_PROBE_INVALID_DURATION',
  'VIDEO_PROBE_UNSUPPORTED_ROTATION',
  'VIDEO_PROBE_UNSUPPORTED_VIDEO',
  'VIDEO_PROBE_SOURCE_GENERATION_UNAVAILABLE',
]);

export function classifyVideoSourceProbeFailure(error: unknown):
  VideoSourceProbeFailure {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code : null;
  if (typeof code !== 'string' || !/^VIDEO_PROBE_[A-Z0-9_]{1,80}$/.test(code)) {
    return new VideoSourceProbeFailure('VIDEO_PROBE_UNAVAILABLE', true);
  }
  if (PERMANENT_CODES.has(code)) {
    return new VideoSourceProbeFailure(code, false);
  }
  return new VideoSourceProbeFailure('VIDEO_PROBE_UNAVAILABLE', true);
}

/** Repeated worker outages must never trigger duplicate Transcoder submission. */
export function nextVideoSourceProbeRetryAt(now: number, attempts: number): number {
  const boundedAttempts = Math.max(1, Math.min(8, Math.trunc(attempts)));
  return now + Math.min(60 * 60_000, 60_000 * 2 ** (boundedAttempts - 1));
}
