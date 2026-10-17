/**
 * Validate the exact immutable copy before cancellation cleanup. GCS object
 * generations must remain strings; stale or foreign storage objects are retained.
 */
import { matchesPersistedImmutableInput } from './video-immutable-input.policy';
import type { VideoProcessingJob } from './video-processing-job';
import { normalizeGcsGeneration } from './video-deletion-storage-pages';

export interface ImmutableCancellationTarget {
  readonly path: string;
  readonly generation: string;
  readonly sizeBytes: number;
  readonly crc32c: string;
  readonly contentType: string;
  readonly processingVersion: string;
  readonly sourceStoragePath: string;
  readonly sourceGeneration: string;
}

export interface ImmutableCancellationObject {
  readonly generation?: unknown;
  readonly size?: unknown;
  readonly crc32c?: unknown;
  readonly contentType?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function selectImmutableCancellationTarget(
  job: VideoProcessingJob
): ImmutableCancellationTarget | null {
  if (job.immutableInput == null) return null;
  if (!matchesPersistedImmutableInput(job, job.immutableInput)) {
    throw new Error('IMMUTABLE_CLEANUP_INVALID_SNAPSHOT');
  }
  const input = job.immutableInput;
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 ||
      input.sizeBytes > 500 * 1024 * 1024) {
    throw new Error('IMMUTABLE_CLEANUP_INVALID_SIZE');
  }
  const generation = normalizeGcsGeneration(input.destinationGeneration);
  if (!generation || typeof input.destinationGeneration !== 'string') {
    throw new Error('IMMUTABLE_CLEANUP_INVALID_GENERATION');
  }
  return {
    path: input.destinationStoragePath,
    generation,
    sizeBytes: input.sizeBytes,
    crc32c: input.crc32c,
    contentType: job.sourceMimeType,
    processingVersion: job.processingVersion,
    sourceStoragePath: job.sourceStoragePath,
    sourceGeneration: input.sourceGeneration,
  };
}

export function matchesImmutableCancellationObject(
  target: ImmutableCancellationTarget,
  object: ImmutableCancellationObject | null
): boolean {
  if (!object || typeof object.generation !== 'string' ||
      normalizeGcsGeneration(object.generation) !== target.generation) {
    return false;
  }
  const metadata = object.metadata;
  return String(object.size ?? '') === String(target.sizeBytes) &&
    object.contentType === target.contentType &&
    object.crc32c === target.crc32c &&
    metadata?.['source'] === 'video-immutable-transcoder-input' &&
    metadata['processingVersion'] === target.processingVersion &&
    metadata['sourceStoragePath'] === target.sourceStoragePath &&
    metadata['sourceGeneration'] === target.sourceGeneration &&
    metadata['sourceCrc32c'] === target.crc32c;
}

export interface ImmutableCancellationCleanupPorts {
  claimIsCurrent(): Promise<boolean>;
  readObject(path: string): Promise<ImmutableCancellationObject | null>;
  deletePinned(path: string, generation: string): Promise<void>;
}

/** Return false for a superseded cancellation; throw to retain retry tracking. */
export async function cleanupCancelledImmutableInput(
  job: VideoProcessingJob,
  ports: ImmutableCancellationCleanupPorts
): Promise<boolean> {
  const target = selectImmutableCancellationTarget(job);
  if (!target) return true;
  if (!await ports.claimIsCurrent()) return false;
  const object = await ports.readObject(target.path);
  if (object === null) return ports.claimIsCurrent();
  if (!matchesImmutableCancellationObject(target, object)) {
    throw new Error('IMMUTABLE_CLEANUP_GENERATION_OR_PROVENANCE_CONFLICT');
  }
  if (!await ports.claimIsCurrent()) return false;
  await ports.deletePinned(target.path, target.generation);
  return true;
}
