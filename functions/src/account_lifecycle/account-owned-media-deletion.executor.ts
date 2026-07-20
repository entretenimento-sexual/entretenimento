// functions/src/account_lifecycle/account-owned-media-deletion.executor.ts
// -----------------------------------------------------------------------------
// OWNED MEDIA AND STORAGE DELETION EXECUTOR
// -----------------------------------------------------------------------------
// Remove mídia privada pertencente à conta antes da exclusão do documento users.
// Conteúdo compartilhado, denúncias e evidências não pertencem a este domínio.
// -----------------------------------------------------------------------------
import type { AccountDataDeletionDomainExecution } from './account-data-deletion.executor';

export type OwnedMediaCleanupJobKind =
  | 'photo_deletion'
  | 'video_deletion'
  | 'published_photo_asset'
  | 'published_video_asset';

export interface OwnedVideoProcessingPageSummary {
  scanned: number;
  processed: number;
  blocking: number;
}

export interface AccountOwnedMediaDeletionAdapter {
  deleteOwnedPhotosPage(uid: string, limit: number): Promise<number>;
  deleteOwnedVideosPage(uid: string, limit: number): Promise<number>;
  deleteOwnedPhotoPublicationsPage(uid: string, limit: number): Promise<number>;
  deleteOwnedVideoPublicationsPage(uid: string, limit: number): Promise<number>;
  deleteOwnedImageStatesPage(uid: string, limit: number): Promise<number>;
  deleteOwnedPublicMediaProjection(uid: string): Promise<number>;
  resolveOwnedVideoProcessingJobsPage(
    uid: string,
    limit: number
  ): Promise<OwnedVideoProcessingPageSummary>;
  deleteOwnedStorageObjectsPage(uid: string, limit: number): Promise<number>;
  deleteOwnedMediaCleanupJobsPage(
    uid: string,
    kind: OwnedMediaCleanupJobKind,
    limit: number
  ): Promise<number>;
}

export interface ExecuteOwnedMediaDeletionInput {
  uid: string;
  pageSize?: number;
  maxPagesPerStep?: number;
}

interface PagedExecutionResult {
  completed: boolean;
  processed: number;
  pages: number;
}

interface ProcessingExecutionResult extends PagedExecutionResult {
  blocking: number;
}

interface MediaMetadataExecution {
  photos: PagedExecutionResult;
  videos: PagedExecutionResult;
  photoPublications: PagedExecutionResult;
  videoPublications: PagedExecutionResult;
  imageStates: PagedExecutionResult;
  publicProjection: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES = 50;

const CLEANUP_KINDS: readonly OwnedMediaCleanupJobKind[] = [
  'photo_deletion',
  'video_deletion',
  'published_photo_asset',
  'published_video_asset',
];

export async function executeOwnedMediaAndStorageDomain(
  adapter: AccountOwnedMediaDeletionAdapter,
  input: ExecuteOwnedMediaDeletionInput
): Promise<AccountDataDeletionDomainExecution> {
  const uid = normalizeUid(input.uid);
  const pageSize = normalizeInteger(
    input.pageSize,
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE
  );
  const maxPages = normalizeInteger(
    input.maxPagesPerStep,
    DEFAULT_MAX_PAGES,
    1,
    MAX_PAGES
  );

  if (!uid) {
    return failedResult(new Error('UID inválido para exclusão de mídia.'));
  }

  try {
    const metadata = await executeMetadataSteps(
      adapter,
      uid,
      pageSize,
      maxPages
    );
    const metadataProcessed = countMetadataProcessed(metadata);
    const metadataPages = countMetadataPages(metadata);

    if (!metadataCompleted(metadata)) {
      return {
        domain: 'owned_media_and_storage',
        status: 'partial',
        processed: metadataProcessed,
        pages: metadataPages,
        blocker: 'pagination-limit-reached',
        details: metadataDetails(metadata),
      };
    }

    const processing = await executeProcessingStep(
      () => adapter.resolveOwnedVideoProcessingJobsPage(uid, pageSize),
      pageSize,
      maxPages
    );

    if (processing.blocking > 0) {
      return {
        domain: 'owned_media_and_storage',
        status: 'blocked',
        processed: metadataProcessed + processing.processed,
        pages: metadataPages + processing.pages,
        blocker: 'video-processing-cancellation-pending',
        details: {
          ...metadataDetails(metadata),
          processingJobsProcessed: processing.processed,
          processingJobsBlocking: processing.blocking,
        },
      };
    }

    if (!processing.completed) {
      return {
        domain: 'owned_media_and_storage',
        status: 'partial',
        processed: metadataProcessed + processing.processed,
        pages: metadataPages + processing.pages,
        blocker: 'pagination-limit-reached',
        details: {
          ...metadataDetails(metadata),
          processingJobsProcessed: processing.processed,
          processingJobsBlocking: 0,
        },
      };
    }

    const storageObjects = await executePagedStep(
      () => adapter.deleteOwnedStorageObjectsPage(uid, pageSize),
      pageSize,
      maxPages
    );

    if (!storageObjects.completed) {
      return {
        domain: 'owned_media_and_storage',
        status: 'partial',
        processed:
          metadataProcessed + processing.processed + storageObjects.processed,
        pages: metadataPages + processing.pages + storageObjects.pages,
        blocker: 'pagination-limit-reached',
        details: {
          ...metadataDetails(metadata),
          processingJobsProcessed: processing.processed,
          processingJobsBlocking: 0,
          storageObjectsDeleted: storageObjects.processed,
        },
      };
    }

    const cleanupResults = await executeCleanupSteps(
      adapter,
      uid,
      pageSize,
      maxPages
    );
    const cleanupCompleted = CLEANUP_KINDS.every(
      (kind) => cleanupResults[kind].completed
    );
    const cleanupProcessed = CLEANUP_KINDS.reduce(
      (total, kind) => total + cleanupResults[kind].processed,
      0
    );
    const cleanupPages = CLEANUP_KINDS.reduce(
      (total, kind) => total + cleanupResults[kind].pages,
      0
    );

    return {
      domain: 'owned_media_and_storage',
      status: cleanupCompleted ? 'completed' : 'partial',
      processed:
        metadataProcessed +
        processing.processed +
        storageObjects.processed +
        cleanupProcessed,
      pages:
        metadataPages +
        processing.pages +
        storageObjects.pages +
        cleanupPages,
      ...(cleanupCompleted ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        ...metadataDetails(metadata),
        processingJobsProcessed: processing.processed,
        processingJobsBlocking: 0,
        storageObjectsDeleted: storageObjects.processed,
        photoDeletionJobsDeleted:
          cleanupResults.photo_deletion.processed,
        videoDeletionJobsDeleted:
          cleanupResults.video_deletion.processed,
        publishedPhotoCleanupJobsDeleted:
          cleanupResults.published_photo_asset.processed,
        publishedVideoCleanupJobsDeleted:
          cleanupResults.published_video_asset.processed,
      },
    };
  } catch (error: unknown) {
    return failedResult(error);
  }
}

async function executeMetadataSteps(
  adapter: AccountOwnedMediaDeletionAdapter,
  uid: string,
  pageSize: number,
  maxPages: number
): Promise<MediaMetadataExecution> {
  const photos = await executePagedStep(
    () => adapter.deleteOwnedPhotosPage(uid, pageSize),
    pageSize,
    maxPages
  );
  const videos = await executePagedStep(
    () => adapter.deleteOwnedVideosPage(uid, pageSize),
    pageSize,
    maxPages
  );
  const photoPublications = await executePagedStep(
    () => adapter.deleteOwnedPhotoPublicationsPage(uid, pageSize),
    pageSize,
    maxPages
  );
  const videoPublications = await executePagedStep(
    () => adapter.deleteOwnedVideoPublicationsPage(uid, pageSize),
    pageSize,
    maxPages
  );
  const imageStates = await executePagedStep(
    () => adapter.deleteOwnedImageStatesPage(uid, pageSize),
    pageSize,
    maxPages
  );
  const publicProjection = normalizeProcessedCount(
    await adapter.deleteOwnedPublicMediaProjection(uid),
    1
  );

  return {
    photos,
    videos,
    photoPublications,
    videoPublications,
    imageStates,
    publicProjection,
  };
}

async function executeCleanupSteps(
  adapter: AccountOwnedMediaDeletionAdapter,
  uid: string,
  pageSize: number,
  maxPages: number
): Promise<Record<OwnedMediaCleanupJobKind, PagedExecutionResult>> {
  const results: Record<OwnedMediaCleanupJobKind, PagedExecutionResult> = {
    photo_deletion: emptyPagedResult(),
    video_deletion: emptyPagedResult(),
    published_photo_asset: emptyPagedResult(),
    published_video_asset: emptyPagedResult(),
  };

  for (const kind of CLEANUP_KINDS) {
    results[kind] = await executePagedStep(
      () => adapter.deleteOwnedMediaCleanupJobsPage(uid, kind, pageSize),
      pageSize,
      maxPages
    );
  }

  return results;
}

function metadataCompleted(metadata: MediaMetadataExecution): boolean {
  return (
    metadata.photos.completed &&
    metadata.videos.completed &&
    metadata.photoPublications.completed &&
    metadata.videoPublications.completed &&
    metadata.imageStates.completed
  );
}

function countMetadataProcessed(metadata: MediaMetadataExecution): number {
  return (
    metadata.photos.processed +
    metadata.videos.processed +
    metadata.photoPublications.processed +
    metadata.videoPublications.processed +
    metadata.imageStates.processed +
    metadata.publicProjection
  );
}

function countMetadataPages(metadata: MediaMetadataExecution): number {
  return (
    metadata.photos.pages +
    metadata.videos.pages +
    metadata.photoPublications.pages +
    metadata.videoPublications.pages +
    metadata.imageStates.pages +
    1
  );
}

function metadataDetails(
  metadata: MediaMetadataExecution
): Record<string, number> {
  return {
    photosProcessed: metadata.photos.processed,
    videosProcessed: metadata.videos.processed,
    photoPublicationsProcessed: metadata.photoPublications.processed,
    videoPublicationsProcessed: metadata.videoPublications.processed,
    imageStatesProcessed: metadata.imageStates.processed,
    publicProjectionProcessed: metadata.publicProjection,
  };
}

async function executePagedStep(
  action: () => Promise<number>,
  pageSize: number,
  maxPages: number
): Promise<PagedExecutionResult> {
  let processed = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageProcessed = normalizeProcessedCount(await action(), pageSize);
    processed += pageProcessed;

    if (pageProcessed < pageSize) {
      return { completed: true, processed, pages: page };
    }
  }

  return { completed: false, processed, pages: maxPages };
}

async function executeProcessingStep(
  action: () => Promise<OwnedVideoProcessingPageSummary>,
  pageSize: number,
  maxPages: number
): Promise<ProcessingExecutionResult> {
  let processed = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const summary = normalizeProcessingSummary(await action(), pageSize);
    processed += summary.processed;

    if (summary.blocking > 0) {
      return {
        completed: false,
        processed,
        pages: page,
        blocking: summary.blocking,
      };
    }

    if (summary.scanned < pageSize) {
      return { completed: true, processed, pages: page, blocking: 0 };
    }
  }

  return {
    completed: false,
    processed,
    pages: maxPages,
    blocking: 0,
  };
}

function normalizeProcessingSummary(
  value: OwnedVideoProcessingPageSummary,
  pageSize: number
): OwnedVideoProcessingPageSummary {
  return {
    scanned: normalizeProcessedCount(value?.scanned, pageSize),
    processed: normalizeProcessedCount(value?.processed, pageSize),
    blocking: normalizeProcessedCount(value?.blocking, pageSize),
  };
}

function normalizeProcessedCount(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), max) : 0;
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function normalizeUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(uid) ? uid : '';
}

function emptyPagedResult(): PagedExecutionResult {
  return { completed: true, processed: 0, pages: 0 };
}

function failedResult(error: unknown): AccountDataDeletionDomainExecution {
  const source = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = String(source.code ?? 'owned-media-deletion-failed').slice(0, 120);
  const message = String(source.message ?? error ?? 'unknown').slice(0, 500);

  return {
    domain: 'owned_media_and_storage',
    status: 'failed',
    processed: 0,
    pages: 0,
    errorCode: code,
    details: { errorMessage: message },
  };
}
