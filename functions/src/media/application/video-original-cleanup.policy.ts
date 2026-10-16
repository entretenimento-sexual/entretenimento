import { createHash } from 'node:crypto';

import { normalizeGcsGeneration } from './video-deletion-storage-pages';
import {
  extractOwnedPrivateVideoPathForId,
  normalizeOwnedProcessedVideoPath,
} from './video-storage-path';
import { normalizePublishedVideoPlaybackPath } from './published-video-storage-mode.policy';

export const VIDEO_ORIGINAL_CLEANUP_COLLECTION = 'media_video_original_cleanup_jobs';
export const VIDEO_ORIGINAL_CLEANUP_GRACE_MS = 30 * 60 * 1000;

export interface VideoOriginalCleanupJob {
  ownerUid: string;
  videoId: string;
  sourceStoragePath: string;
  sourceGeneration: string;
  processedStoragePath: string;
  publishedStoragePath: string;
  assetStorageMode?: 'PROCESSED_CANONICAL';
  state: 'retryable' | 'dead_letter';
  attempts: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt: number | null;
  deadLetterExpiresAt: number | null;
  leaseToken: string | null;
  leaseUntil: number | null;
  lastError: string | null;
}

export function videoOriginalCleanupJobId(ownerUid: string, videoId: string): string {
  return createHash('sha256')
    .update(JSON.stringify([ownerUid, videoId]))
    .digest('hex');
}

/** Only newly registered immutable sources with a known generation are eligible. */
export function buildVideoOriginalCleanupJob(input: {
  ownerUid: string;
  videoId: string;
  sourceStoragePath: unknown;
  sourceGeneration: unknown;
  processedStoragePath: unknown;
  publishedStoragePath: unknown;
  assetStorageMode?: unknown;
  now: number;
}): VideoOriginalCleanupJob | null {
  const { ownerUid, videoId, now } = input;
  if (!Number.isSafeInteger(now) || now <= 0) return null;
  const sourceStoragePath = extractOwnedPrivateVideoPathForId(
    ownerUid, videoId, input.sourceStoragePath
  );
  const sourceGeneration = normalizeGcsGeneration(input.sourceGeneration);
  const processedStoragePath = normalizeOwnedProcessedVideoPath(
    ownerUid, videoId, input.processedStoragePath
  );
  const mode = input.assetStorageMode;
  if (mode !== undefined && mode !== 'PROCESSED_CANONICAL') return null;
  const publishedStoragePath = normalizePublishedVideoPlaybackPath(
    ownerUid, videoId, input.publishedStoragePath, mode
  );
  if (mode === 'PROCESSED_CANONICAL' &&
      publishedStoragePath !== processedStoragePath) return null;
  if (!sourceStoragePath || !sourceGeneration ||
      !processedStoragePath || !publishedStoragePath) return null;

  return {
    ownerUid, videoId, sourceStoragePath, sourceGeneration,
    processedStoragePath, publishedStoragePath,
    ...(mode === 'PROCESSED_CANONICAL' ? {assetStorageMode: mode} : {}),
    state: 'retryable', attempts: 0,
    createdAt: now, updatedAt: now,
    nextAttemptAt: now + VIDEO_ORIGINAL_CLEANUP_GRACE_MS,
    deadLetterExpiresAt: null, leaseToken: null, leaseUntil: null,
    lastError: null,
  };
}

/** Review holds and uncertain legacy state fail closed. */
export function mayDeletePublishedVideoOriginal(
  job: VideoOriginalCleanupJob,
  video: Record<string, unknown> | null,
  publication: Record<string, unknown> | null,
  processing: Record<string, unknown> | null
): boolean {
  if (!video || !publication || !processing ||
      !buildVideoOriginalCleanupJob({ ...job, now: job.createdAt })) return false;
  if (video['ownerUid'] !== job.ownerUid ||
      video['status'] !== 'ready' ||
      video['path'] !== job.sourceStoragePath ||
      video['sourceGeneration'] !== job.sourceGeneration ||
      video['processedStoragePath'] !== job.processedStoragePath) return false;
  if (publication['ownerUid'] !== job.ownerUid ||
      publication['videoId'] !== job.videoId ||
      publication['isPublished'] !== true ||
      publication['moderationStatus'] !== 'APPROVED' ||
      publication['sourceStoragePath'] !== job.sourceStoragePath ||
      publication['publishedStoragePath'] !== job.publishedStoragePath ||
      publication['assetStorageMode'] !== job.assetStorageMode ||
      // A locked publication or evidence hold must not lose its source.
      !!publication['reviewEvidenceRetention']) return false;
  if (processing['ownerUid'] !== job.ownerUid ||
      processing['videoId'] !== job.videoId ||
      processing['state'] !== 'SUCCEEDED' ||
      processing['outputStoragePath'] !== job.processedStoragePath) return false;
  return true;
}
