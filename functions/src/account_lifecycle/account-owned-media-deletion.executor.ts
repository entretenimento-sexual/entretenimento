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

    if (!photos.completed || !videos.completed) {
      return {
        domain: 'owned_media_and_storage',
        status: 'partial',
        processed: photos.processed + videos.processed,
        pages: photos.pages + videos.pages,
        blocker: 'pagination-limit-reached',
        details: {
          photosProcessed: photos.processed,
          videosProcessed: videos.processed,
        },
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
        processed:
          photos.processed + videos.processed + processing.processed,
        pages: photos.pages + videos.pages + processing.pages,
        blocker: 'video-processing-cancellation-pending',
        details: {
          photosProcessed: photos.processed,
          videosProcessed: videos.processed,
          processingJobsProcessed: processing.processed,
          processingJobsBlocking: processing.blocking,
        },
      };
    }

    if (!processing.completed) {
      return {
        domain: 'owned_media_and_storage',
        status: 'partial',
        processed:
          photos.processed + videos.processed + processing.processed,
        pages: photos.pages + videos.pages + processing.pages,
        blocker: 'pagination-limit-reached',
        details: {
          photosProcessed: photos.processed,
          videosProcessed: videos.processed,
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
          photos.processed +
          videos.processed +
          processing.processed +
          storageObjects.processed,
        pages:
          photos.pages +
          videos.pages +
          processing.pages +
          storageObjects.pages,
        blocker: 'pagination-limit-reached',
        details: {
          photosProcessed: photos.processed,
          videosProcessed: videos.processed,
          processingJobsProcessed: processing.processed,
          storageObjectsDeleted: storageObjects.processed,
        },
      };
    }

    const cleanupResults: Record<OwnedMediaCleanupJobKind, PagedExecutionResult> = {
      photo_deletion: emptyPagedResult(),
      video_deletion: emptyPagedResult(),
      published_photo_asset: emptyPagedResult(),
      published_video_asset: emptyPagedResult(),
    };

    for (const kind of CLEANUP_KINDS) {
      cleanupResults[kind] = await executePagedStep(
        () => adapter.deleteOwnedMediaCleanupJobsPage(uid, kind, pageSize),
        pageSize,
        maxPages
      );
    }

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
    const processed =
      photos.processed +
      videos.processed +
      processing.processed +
      storageObjects.processed +
      cleanupProcessed;
    const pages =
      photos.pages +
      videos.pages +
      processing.pages +
      storageObjects.pages +
      cleanupPages;

    return {
      domain: 'owned_media_and_storage',
      status: cleanupCompleted ? 'completed' : 'partial',
      processed,
      pages,
      ...(cleanupCompleted ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        photosProcessed: photos.processed,
        videosProcessed: videos.processed,
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

function normalizeProcessedCount(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
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
