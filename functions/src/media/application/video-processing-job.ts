import { randomUUID } from 'node:crypto';

import {
  DEFAULT_VIDEO_EDIT_RECIPE,
  resolveEditedVideoDurationMs,
  resolveVideoEditGeometry,
  type VideoEditRecipe,
} from './video-edit-recipe';

export type VideoProcessingJobState =
  | 'QUEUED'
  | 'SUBMITTING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED';

export interface VideoProviderTerminalEvidence {
  readonly processingVersion: string;
  readonly externalJobName: string;
  readonly state: 'SUCCEEDED' | 'FAILED';
  readonly observedAt: number;
}

export interface VideoProcessingJob {
  ownerUid: string;
  videoId: string;
  sourceStoragePath: string;
  sourceGeneration?: string | null;
  /** Validated ffprobe result fenced to this immutable source/version. */
  sourceProbe?: import('./video-source-probe.policy').VideoSourceProbeSnapshot | null;
  /** Preparatory only: persisted, version-fenced copy; not yet used by provider. */
  immutableInput?: import('./video-immutable-input.policy').ImmutableTranscoderInput | null;
  immutableInputClaimId?: string | null;
  immutableInputAttempts?: number;
  sourceProbeClaimId?: string | null;
  sourceProbeAttempts?: number;
  sourcePosterStoragePath: string | null;
  sourceMimeType: string;
  sourceSizeBytes: number;
  sourceDurationMs: number | null;
  outputPrefix: string;
  processingVersion: string;
  provider: 'GOOGLE_TRANSCODER';
  state: VideoProcessingJobState;
  attempts: number;
  /** Consecutive negative provider lookups for this submission. */
  submissionLookupMisses?: number;
  /** Number of failed external cleanup attempts for this cancellation. */
  cancellationCleanupAttempts?: number;
  /** Exposes uncertain or repeated cancellation failures to administrators. */
  cancellationReviewRequired?: boolean;
  nextAttemptAt: number;
  leaseUntil: number | null;
  externalJobName: string | null;
  providerState: string | null;
  /** Evidence of a successful GET for this exact terminal provider job. */
  providerTerminalEvidence?: VideoProviderTerminalEvidence | null;
  /** Consecutive provider GET failures for this processingVersion. */
  providerPollFailureVersion?: string | null;
  providerPollFailureCount?: number;
  providerPollLastFailedAt?: number | null;
  providerPollReviewRequired?: boolean;
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
  /** Campos opcionais preservam compatibilidade com jobs legados. */
  editRecipe?: VideoEditRecipe;
  outputDurationMs?: number | null;
  outputWidthPixels?: number | null;
  outputHeightPixels?: number | null;
}

export interface BuildQueuedVideoProcessingJobCommand {
  ownerUid: string;
  videoId: string;
  sourceStoragePath: string;
  sourceGeneration?: string | null;
  sourcePosterStoragePath: string | null;
  sourceMimeType: string;
  sourceSizeBytes: number;
  sourceDurationMs: number | null;
  editRecipe?: VideoEditRecipe;
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
  const editRecipe = command.editRecipe ?? DEFAULT_VIDEO_EDIT_RECIPE;
  const geometry = resolveVideoEditGeometry(editRecipe);

  return {
    ownerUid: command.ownerUid,
    videoId: command.videoId,
    sourceStoragePath: command.sourceStoragePath,
    ...(command.sourceGeneration ? { sourceGeneration: command.sourceGeneration } : {}),
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
    submissionLookupMisses: 0,
    cancellationCleanupAttempts: 0,
    cancellationReviewRequired: false,
    nextAttemptAt: now,
    leaseUntil: null,
    externalJobName: null,
    providerState: null,
    providerPollFailureVersion: null,
    providerPollFailureCount: 0,
    providerPollLastFailedAt: null,
    providerPollReviewRequired: false,
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
    editRecipe,
    outputDurationMs: resolveEditedVideoDurationMs(
      editRecipe,
      command.sourceDurationMs
    ),
    outputWidthPixels: geometry?.outputWidthPixels ?? null,
    outputHeightPixels: geometry?.outputHeightPixels ?? null,
  };
}
