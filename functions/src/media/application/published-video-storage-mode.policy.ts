import {
  normalizeOwnedProcessedVideoPath,
  normalizeOwnedProcessedVideoPrefix,
  normalizeOwnedPublishedVideoPath,
} from './video-storage-path';

/** Legacy publications omit the mode and continue using their copied assets. */
export function normalizePublishedVideoPlaybackPath(
  ownerUid: string,
  videoId: string,
  candidate: unknown,
  mode: unknown
): string | null {
  if (mode === 'PROCESSED_CANONICAL') {
    return normalizeOwnedProcessedVideoPath(ownerUid, videoId, candidate);
  }
  if (mode === undefined || mode === null || mode === 'COPIED_PUBLISHED') {
    return normalizeOwnedPublishedVideoPath(ownerUid, videoId, candidate);
  }
  return null;
}

type PublishedVideoDeletionPathDecision =
  | 'COPIED_ASSET'
  | 'HANDLED_BY_PROCESSED_PREFIX'
  | 'BLOCKED';

/** The processed prefix must own the precise canonical published object. */
export function decidePublishedVideoDeletionPath(
  ownerUid: string,
  videoId: string,
  publishedPath: unknown,
  processedPrefix: unknown
): PublishedVideoDeletionPathDecision {
  const canonical = normalizeOwnedProcessedVideoPath(ownerUid, videoId, publishedPath);
  if (!canonical) return 'COPIED_ASSET';
  const prefix = normalizeOwnedProcessedVideoPrefix(ownerUid, videoId, processedPrefix);
  return prefix && canonical.startsWith(prefix)
    ? 'HANDLED_BY_PROCESSED_PREFIX'
    : 'BLOCKED';
}
