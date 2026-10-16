import type { Firestore } from 'firebase-admin/firestore';

import { isCurrentPublicMediaAssetExposure } from './public-media-exposure.policy';
import { resolvePublicMediaSignedUrlExpiresAt } from './public-media-signed-url-expiry.policy';
import {
  shouldIssuePublicVideoPlaybackAccess,
  type TPublicVideoAccessMode,
} from './public-video-access-mode';
import { normalizeOwnedPublishedVideoPosterPath } from './video-storage-path';
import { normalizePublishedVideoPlaybackPath } from './published-video-storage-mode.policy';

export interface PublicVideoSignedAccessItem {
  ownerUid: string;
  videoId: string;
  url: string | null;
  posterUrl: string | null;
  expiresAt: number;
}

export interface PublicVideoSignedAccessRequest {
  ownerUid: string;
  videoId: string;
  technicalExpiresAt: number;
  requesterAccessExpiresAtMs: number | null;
  ownerAccessExpiresAtMs: number | null;
  ownerExposureAllowed: boolean;
  mode: TPublicVideoAccessMode;
  nowMs: number;
}

export interface PublicVideoSignedAccessPorts {
  fileExists: (path: string) => Promise<boolean>;
  createReadUrl: (path: string, expiresAt: number) => Promise<string>;
}

/**
 * Production's per-item authorization and signing boundary. The requester
 * lifecycle, bilateral block, and owner lifecycle checks are resolved once
 * per batch by the callable. No URL is created before these checks and the
 * authoritative publication/projection checks below succeed.
 */
export async function resolvePublicVideoSignedAccessItem(
  firestore: Firestore,
  request: PublicVideoSignedAccessRequest,
  ports: PublicVideoSignedAccessPorts
): Promise<PublicVideoSignedAccessItem | null> {
  const {
    ownerUid, videoId, technicalExpiresAt,
    requesterAccessExpiresAtMs, ownerAccessExpiresAtMs,
    ownerExposureAllowed, mode, nowMs,
  } = request;

  if (!ownerExposureAllowed) {
    return null;
  }

  const [publicVideoSnap, publicationSnap] = await Promise.all([
    firestore.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    ).get(),
    firestore.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    ).get(),
  ]);

  if (!publicVideoSnap.exists || !publicationSnap.exists) {
    return null;
  }

  const publicVideo = publicVideoSnap.data() as Record<string, unknown>;
  const publication = publicationSnap.data() as Record<string, unknown>;

  if (!isCurrentPublicMediaAssetExposure({
    publicMedia: publicVideo,
    publication,
    ownerExposureAllowed,
    nowMs,
    allowedVisibilities: ['PUBLIC'],
  })) {
    return null;
  }

  const videoStoragePath = normalizePublishedVideoPlaybackPath(
    ownerUid, videoId, publication['publishedStoragePath'],
    publication['assetStorageMode']
  );

  if (!videoStoragePath) {
    return null;
  }

  const expiresAt = resolvePublicMediaSignedUrlExpiresAt({
    nowMs,
    technicalExpiresAtMs: technicalExpiresAt,
    requesterAccessExpiresAtMs,
    ownerAccessExpiresAtMs,
  });

  if (expiresAt === null) {
    return null;
  }

  let url: string | null = null;

  if (shouldIssuePublicVideoPlaybackAccess(mode)) {
    if (!(await ports.fileExists(videoStoragePath))) {
      throw new Error(
        'O ativo publicado do vídeo não foi encontrado no Storage.'
      );
    }

    url = await ports.createReadUrl(videoStoragePath, expiresAt);
  }

  const posterStoragePath = normalizeOwnedPublishedVideoPosterPath(
    ownerUid, videoId, publication['publishedPosterStoragePath']
  );
  let posterUrl: string | null = null;

  if (posterStoragePath && await ports.fileExists(posterStoragePath)) {
    posterUrl = await ports.createReadUrl(posterStoragePath, expiresAt);
  }

  return { ownerUid, videoId, url, posterUrl, expiresAt };
}
