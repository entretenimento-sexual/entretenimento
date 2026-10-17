/**
 * Last Firestore-boundary check before a billable Google Transcoder POST.
 * Firestore cannot atomically commit a third-party POST: a cancellation that
 * happens after this read is still handled by provider cancellation/recovery.
 * This policy never returns a previous authorization as a reusable token.
 */
import { selectTranscoderInputSource } from './video-immutable-input.policy';
import type { VideoProcessingJob } from './video-processing-job';
import { extractOwnedPrivateVideoPathForId } from './video-storage-path';

export interface TranscoderPrivateSource {
  readonly path?: unknown;
  readonly url?: unknown;
  readonly sourceGeneration?: unknown;
}

export function canSubmitCurrentTranscoderJob(
  current: VideoProcessingJob | null,
  observed: VideoProcessingJob,
  video: TranscoderPrivateSource | null,
  now: number,
  immutableRequired: boolean
): boolean {
  if (!current || !video ||
      !Number.isSafeInteger(now) || now <= 0 ||
      observed.state !== 'SUBMITTING' ||
      current.state !== 'SUBMITTING' ||
      current.provider !== 'GOOGLE_TRANSCODER' ||
      current.ownerUid !== observed.ownerUid ||
      current.videoId !== observed.videoId ||
      current.processingVersion !== observed.processingVersion ||
      current.attempts !== observed.attempts ||
      current.sourceStoragePath !== observed.sourceStoragePath ||
      current.sourceGeneration !== observed.sourceGeneration ||
      current.sourceSizeBytes !== observed.sourceSizeBytes ||
      current.sourceMimeType !== observed.sourceMimeType ||
      current.outputPrefix !== observed.outputPrefix ||
      current.nextAttemptAt !== observed.nextAttemptAt ||
      current.leaseUntil == null ||
      current.leaseUntil !== observed.leaseUntil ||
      current.leaseUntil <= now ||
      current.cancelRequestedAt != null ||
      current.externalJobName != null) return false;

  const privatePath = extractOwnedPrivateVideoPathForId(
    observed.ownerUid, observed.videoId, video.path
  ) ?? extractOwnedPrivateVideoPathForId(
    observed.ownerUid, observed.videoId, video.url
  );
  if (privatePath !== observed.sourceStoragePath ||
      (observed.sourceGeneration != null &&
        video.sourceGeneration !== observed.sourceGeneration)) return false;

  const selected = selectTranscoderInputSource(observed, immutableRequired);
  const currentSelected = selectTranscoderInputSource(current, immutableRequired);
  if (!selected || !currentSelected || selected.mode !== currentSelected.mode ||
      selected.sourceStoragePath !== currentSelected.sourceStoragePath) return false;
  if (selected.mode === 'immutable' && currentSelected.mode === 'immutable') {
    return selected.sourceGeneration === currentSelected.sourceGeneration &&
      selected.destinationGeneration === currentSelected.destinationGeneration &&
      selected.sizeBytes === currentSelected.sizeBytes &&
      selected.crc32c === currentSelected.crc32c;
  }
  return selected.mode === 'legacy' && currentSelected.mode === 'legacy';
}

/** No provider I/O is allowed if the fresh transactional guard denies. */
export async function submitAfterTranscoderPostGuard<T>(
  confirm: () => Promise<boolean>,
  post: () => Promise<T>
): Promise<T | null> {
  if (!await confirm()) return null;
  return post();
}
