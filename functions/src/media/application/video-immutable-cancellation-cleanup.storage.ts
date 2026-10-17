/** Cloud Storage adapter for cancellation-time immutable input deletion. */
import { storage } from '../../firebaseApp';
import {
  cleanupCancelledImmutableInput,
  type ImmutableCancellationObject,
} from './video-immutable-cancellation-cleanup.policy';
import { deleteGenerationPinnedVideoFile } from './video-deletion-storage-pages';
import type { VideoProcessingJob } from './video-processing-job';

function is404(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error &&
    Number(error.code) === 404;
}

export async function deleteCancelledImmutableInput(
  job: VideoProcessingJob,
  claimIsCurrent: () => Promise<boolean>
): Promise<boolean> {
  const bucket = storage.bucket();
  return cleanupCancelledImmutableInput(job, {
    claimIsCurrent,
    async readObject(path) {
      try {
        const [metadata] = await bucket.file(path).getMetadata();
        return metadata as ImmutableCancellationObject;
      } catch (error) {
        if (is404(error)) return null;
        throw error;
      }
    },
    async deletePinned(path, generation) {
      await deleteGenerationPinnedVideoFile(generation, expected =>
        bucket.file(path).delete({
          ifGenerationMatch: expected,
          ignoreNotFound: true,
        })
      );
    },
  });
}
