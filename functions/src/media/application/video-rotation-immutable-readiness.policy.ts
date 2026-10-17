/**
 * GCS provenance for a worker-created, version-specific, create-only rotation.
 * This does not authorize the Google Transcoder POST. Re-check GCS generation
 * and job lifecycle at the final submission boundary before activation.
 */
import type { VideoProcessingJob } from './video-processing-job';
import type { TranscoderInputSourceSelection } from './video-immutable-input.policy';

export type PinnedTranscoderInputSource = Extract<
  TranscoderInputSourceSelection, { mode: 'immutable' }
>;

export interface RotationStorageMetadata {
  readonly generation?: string | number;
  readonly size?: string | number;
  readonly contentType?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const GENERATION = /^[1-9][0-9]{0,29}$/;
const MAX_ROTATED_BYTES = 750 * 1024 * 1024;

/** Mirror the worker's strict persisted output provenance contract. */
export function matchesPinnedRotatedSource(
  job: Pick<VideoProcessingJob, 'processingVersion'>,
  source: PinnedTranscoderInputSource,
  rotationDegrees: number,
  raw: RotationStorageMetadata | null | undefined
): boolean {
  if (!raw || ![90, 180, 270].includes(rotationDegrees)) return false;
  const generation = String(raw.generation ?? '');
  const size = Number(raw.size ?? 0);
  const tags = raw.metadata;
  return typeof raw.generation === 'string' && GENERATION.test(generation) &&
    Number.isSafeInteger(size) && size > 0 && size <= MAX_ROTATED_BYTES &&
    String(raw.contentType ?? '').trim().toLowerCase() === 'video/mp4' &&
    tags?.['source'] === 'video-rotation-worker' &&
    tags['processingVersion'] === job.processingVersion &&
    tags['rotationDegrees'] === String(rotationDegrees) &&
    tags['immutableInputStoragePath'] === source.sourceStoragePath &&
    tags['immutableInputGeneration'] === source.destinationGeneration &&
    tags['immutableInputCrc32c'] === source.crc32c;
}
