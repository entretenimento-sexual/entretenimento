import {
  extractOwnedPrivateVideoPath,
  extractOwnedPrivateVideoPathForId,
  normalizeOwnedProcessedVideoPath,
} from './video-storage-path';

interface PrivateVideoPublicationSource {
  status?: unknown;
  path?: unknown;
  url?: unknown;
  processedStoragePath?: unknown;
  playbackPath?: unknown;
}

export function resolveVideoPublicationPrivateSource(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoPublicationSource
): string | null {
  return extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url) ??
    extractOwnedPrivateVideoPath(ownerUid, video.path) ??
    extractOwnedPrivateVideoPath(ownerUid, video.url);
}

export function resolveVideoPublicationProcessedSource(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoPublicationSource
): string | null {
  return normalizeOwnedProcessedVideoPath(
    ownerUid, videoId, video.processedStoragePath
  ) ?? normalizeOwnedProcessedVideoPath(
    ownerUid, videoId, video.playbackPath
  );
}

/** A copied derivative may only be promoted while its private source is current. */
export function isCurrentVideoPublicationSource(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoPublicationSource | null,
  expectedPrivateSource: string,
  copiedProcessedSource: string
): boolean {
  return video !== null &&
    String(video.status ?? '').trim().toLowerCase() === 'ready' &&
    !!expectedPrivateSource &&
    !!copiedProcessedSource &&
    resolveVideoPublicationPrivateSource(ownerUid, videoId, video) ===
      expectedPrivateSource &&
    resolveVideoPublicationProcessedSource(ownerUid, videoId, video) ===
      copiedProcessedSource;
}
