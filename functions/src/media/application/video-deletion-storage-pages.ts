/**
 * Storage cleanup is deliberately bounded: a failed attempt leaves its job
 * for the existing retry scheduler instead of running unbounded GCS work.
 */
export const VIDEO_DELETION_STORAGE_PAGE_SIZE = 20;
export const VIDEO_DELETION_STORAGE_CONCURRENCY = 4;
export const VIDEO_DELETION_STORAGE_MAX_FILES_PER_ATTEMPT = 80;

/** A failed generation match must never turn into an unqualified retry. */
export class VideoDeletionGenerationConflictError extends Error {
  constructor(message = 'Video storage generation conflict; manual review required.') {
    super(message);
    this.name = 'VideoDeletionGenerationConflictError';
  }
}

/** GCS generations are uint64 decimal strings; converting them to JS Number is unsafe. */
function requireGcsGeneration(value: unknown): string {
  const generation = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value) : value;
  if (typeof generation !== 'string' ||
      !/^[1-9]\d{0,19}$/.test(generation) ||
      BigInt(generation) > 18446744073709551615n) {
    throw new VideoDeletionGenerationConflictError(
      'Missing or invalid GCS object generation; manual review required.'
    );
  }
  return generation;
}

/** The provider must atomically reject deletion when an object is replaced (HTTP 412). */
export async function deleteGenerationPinnedVideoFile(
  expectedGeneration: unknown,
  deleteWithGeneration: (generation: string) => Promise<unknown>
): Promise<void> {
  const generation = requireGcsGeneration(expectedGeneration);
  try {
    await deleteWithGeneration(generation);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code : null;
    if (code === 412 || code === '412') {
      throw new VideoDeletionGenerationConflictError();
    }
    throw error;
  }
}

export interface DeletableVideoStorageFile {
  delete(): Promise<unknown>;
}

export type ListVideoStoragePage = (
  prefix: string,
  maxResults: number
) => Promise<readonly DeletableVideoStorageFile[]>;

/** Only an owned, version-specific processed-output prefix may be swept. */
function assertVersionSpecificProcessedPrefix(prefix: string): void {
  if (!/^users\/[^/]+\/processed\/videos\/[^/]+\/[^/]+\/$/.test(prefix)) {
    throw new Error('Unsafe video deletion storage prefix.');
  }
}

export async function deleteVideoStoragePrefixBounded(
  prefix: string,
  listPage: ListVideoStoragePage
): Promise<number> {
  assertVersionSpecificProcessedPrefix(prefix);

  let deleted = 0;
  while (deleted < VIDEO_DELETION_STORAGE_MAX_FILES_PER_ATTEMPT) {
    const limit = Math.min(
      VIDEO_DELETION_STORAGE_PAGE_SIZE,
      VIDEO_DELETION_STORAGE_MAX_FILES_PER_ATTEMPT - deleted
    );
    const files = await listPage(prefix, limit);
    if (files.length > limit) {
      throw new Error('Storage returned more files than the requested page size.');
    }
    if (files.length === 0) return deleted;

    for (let index = 0; index < files.length; index += VIDEO_DELETION_STORAGE_CONCURRENCY) {
      const group = files.slice(index, index + VIDEO_DELETION_STORAGE_CONCURRENCY);
      await Promise.all(group.map((file) => file.delete()));
    }
    deleted += files.length;
  }

  // Stop at the per-attempt work cap. A nonempty continuation must be retried
  // by the existing queue rather than acknowledged as complete.
  if ((await listPage(prefix, 1)).length > 0) {
    throw new Error('Video deletion storage continuation required.');
  }
  return deleted;
}
