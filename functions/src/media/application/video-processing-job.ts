import { randomUUID } from 'node:crypto';

export type VideoProcessingJobState =
  | 'QUEUED'
  | 'SUBMITTING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED';

export interface VideoProcessingJob {
  ownerUid: string;
  videoId: string;
  sourceStoragePath: string;
  sourcePosterStoragePath: string | null;
  sourceMimeType: string;
  sourceSizeBytes: number;
  sourceDurationMs: number | null;
  outputPrefix: string;
  processingVersion: string;
  provider: 'GOOGLE_TRANSCODER';
  state: VideoProcessingJobState;
  attempts: number;
  nextAttemptAt: number;
  leaseUntil: number | null;
  externalJobName: string | null;
  providerState: string | null;
  outputStoragePath: string | null;
  outputMimeType: string | null;
  outputSizeBytes: number | null;
  submittedAt: number | null;
  completedAt: number | null;
  cancelRequestedAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastErrorCode: string | null;
  lastError: string | null;
}

export interface BuildQueuedVideoProcessingJobCommand {
  ownerUid: string;
  videoId: string;
  sourceStoragePath: string;
  sourcePosterStoragePath: string | null;
  sourceMimeType: string;
  sourceSizeBytes: number;
  sourceDurationMs: number | null;
  now?: number;
}

export const VIDEO_PROCESSING_JOBS_COLLECTION =
  'media_video_processing_jobs';
export const VIDEO_PROCESSING_MAX_ATTEMPTS = 5;

export function buildVideoProcessingJobId(
  ownerUid: string,
  videoId: string
): string {
  return `${ownerUid}_${videoId}`;
}

export function buildProcessedVideoOutputPrefix(
  ownerUid: string,
  videoId: string,
  processingVersion: string
): string {
  return (
    `users/${ownerUid}/processed/videos/${videoId}/` +
    `${processingVersion}/`
  );
}

export function buildQueuedVideoProcessingJob(
  command: BuildQueuedVideoProcessingJobCommand
): VideoProcessingJob {
  const now = command.now ?? Date.now();
  const processingVersion = `${now}-${randomUUID()}`;

  return {
    ownerUid: command.ownerUid,
    videoId: command.videoId,
    sourceStoragePath: command.sourceStoragePath,
    sourcePosterStoragePath: command.sourcePosterStoragePath,
    sourceMimeType: command.sourceMimeType,
    sourceSizeBytes: command.sourceSizeBytes,
    sourceDurationMs: command.sourceDurationMs,
    outputPrefix: buildProcessedVideoOutputPrefix(
      command.ownerUid,
      command.videoId,
      processingVersion
    ),
    processingVersion,
    provider: 'GOOGLE_TRANSCODER',
    state: 'QUEUED',
    attempts: 0,
    nextAttemptAt: now,
    leaseUntil: null,
    externalJobName: null,
    providerState: null,
    outputStoragePath: null,
    outputMimeType: null,
    outputSizeBytes: null,
    submittedAt: null,
    completedAt: null,
    cancelRequestedAt: null,
    createdAt: now,
    updatedAt: now,
    lastErrorCode: null,
    lastError: null,
  };
}
