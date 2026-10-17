/**
 * Version-scoped cleanup for temporary Transcoder inputs and rotation results.
 * Original uploads and published derivatives never qualify as targets.
 */
import type { VideoProcessingJob } from './video-processing-job';
import { matchesProviderTerminalEvidence } from './video-provider-terminal-evidence.policy';
import { selectTranscoderInputSource } from './video-immutable-input.policy';
import {
  matchesImmutableCancellationObject,
  selectImmutableCancellationTarget,
  type ImmutableCancellationObject,
} from './video-immutable-cancellation-cleanup.policy';
import { normalizeGcsGeneration } from './video-deletion-storage-pages';
import { matchesPinnedRotatedSource } from './video-rotation-immutable-readiness.policy';
import { buildRotationSourceStoragePath } from './video-rotation-worker.service';

export const VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION =
  'media_video_terminal_temp_cleanup_jobs';

export type TerminalTempCleanupJob = Pick<VideoProcessingJob,
  'ownerUid' | 'videoId' | 'processingVersion' | 'state' | 'providerState' |
  'externalJobName' | 'providerTerminalEvidence' | 'attempts' | 'sourceStoragePath' | 'sourceGeneration' |
  'sourceSizeBytes' | 'sourceMimeType' | 'sourceProbe' | 'immutableInput' | 'editRecipe'>;

export function rotationDegreesForCleanup(job: TerminalTempCleanupJob): number {
  const angle = job.editRecipe?.rotationDegrees;
  return angle === 90 || angle === 180 || angle === 270 ? angle : 0;
}

export function hasTerminalTemporaryAssets(job: TerminalTempCleanupJob): boolean {
  return job.immutableInput != null || rotationDegreesForCleanup(job) !== 0;
}

/** FAILED without verified provider completion may still be reading its input. */
export function isConfirmedTerminalVideoJob(job: TerminalTempCleanupJob): boolean {
  if (job.state !== 'SUCCEEDED' && job.state !== 'FAILED') return false;
  // Only a successful, matching provider GET can authorize terminal deletion.
  if (job.externalJobName) return matchesProviderTerminalEvidence(job);
  // A never-submitted attempt cannot be reading a temporary GCS input.
  return job.state === 'FAILED' && job.attempts === 0 &&
    !job.providerState && !job.providerTerminalEvidence;
}

export interface TerminalTemporaryCleanupPorts {
  claimIsCurrent(): Promise<boolean>;
  readObject(path: string): Promise<ImmutableCancellationObject | null>;
  deletePinned(path: string, generation: string): Promise<void>;
}

function isLegacyRotationProvenance(
  job: TerminalTempCleanupJob,
  angle: number,
  object: ImmutableCancellationObject
): boolean {
  const tags = object.metadata;
  const size = Number(object.size);
  return object.contentType === 'video/mp4' &&
    Number.isSafeInteger(size) && size > 0 && size <= 750 * 1024 * 1024 &&
    tags?.['source'] === 'video-rotation-worker' &&
    tags['processingVersion'] === job.processingVersion &&
    tags['rotationDegrees'] === String(angle);
}

async function cleanupRotationTempWithPorts(
  job: TerminalTempCleanupJob,
  immutablePresent: boolean,
  ports: TerminalTemporaryCleanupPorts
): Promise<boolean> {
  if (immutablePresent) selectImmutableCancellationTarget(job as VideoProcessingJob);
  const angle = rotationDegreesForCleanup(job);
  const rotationPath = angle
    ? buildRotationSourceStoragePath(job) : null;
  if (!await ports.claimIsCurrent()) return false;

  if (rotationPath) {
    const object = await ports.readObject(rotationPath);
    if (object) {
      const generation = normalizeGcsGeneration(object.generation);
      const selected = immutablePresent
        ? selectTranscoderInputSource(job as VideoProcessingJob, true) : null;
      const proven = immutablePresent
        ? !!selected && selected.mode === 'immutable' &&
          matchesPinnedRotatedSource(job, selected, angle, {
            generation: object.generation as string,
            size: object.size as string,
            contentType: object.contentType as string,
            metadata: object.metadata,
          })
        : isLegacyRotationProvenance(job, angle, object);
      if (!generation || typeof object.generation !== 'string' || !proven) {
        throw new Error('VIDEO_TEMP_CLEANUP_ROTATION_PROVENANCE_CONFLICT');
      }
      if (!await ports.claimIsCurrent()) return false;
      await ports.deletePinned(rotationPath, generation);
    }
  }
  return true;
}

/** False means the fenced cleanup claim changed; no success is acknowledged. */
export async function cleanupTerminalVideoTemporaryAssets(
  job: TerminalTempCleanupJob,
  ports: TerminalTemporaryCleanupPorts
): Promise<boolean> {
  if (!isConfirmedTerminalVideoJob(job)) {
    throw new Error('VIDEO_TEMP_CLEANUP_PROVIDER_UNCONFIRMED');
  }
  // Validate persisted immutable identity before the first GCS call.
  const immutable = job.immutableInput != null
    ? selectImmutableCancellationTarget(job as VideoProcessingJob) : null;
  if (!await cleanupRotationTempWithPorts(job, immutable !== null, ports)) return false;
  if (immutable) {
    const object = await ports.readObject(immutable.path);
    if (object && !matchesImmutableCancellationObject(immutable, object)) {
      throw new Error('VIDEO_TEMP_CLEANUP_IMMUTABLE_PROVENANCE_CONFLICT');
    }
    if (!await ports.claimIsCurrent()) return false;
    if (object) await ports.deletePinned(immutable.path, immutable.generation);
  }
  return true;
}

/**
 * Caller must prove that provider deletion has completed when invoked by the
 * cancellation executor; failed deletes retain the durable cancellation job.
 */
export async function cleanupCancelledRotationTemporaryAsset(
  job: TerminalTempCleanupJob,
  ports: TerminalTemporaryCleanupPorts
): Promise<boolean> {
  return cleanupRotationTempWithPorts(job, job.immutableInput != null, ports);
}
