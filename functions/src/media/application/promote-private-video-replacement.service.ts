import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import {
  cleanupReplacedPrivateVideoAssetsOrQueue,
} from './private-video-replacement-cleanup.service';
import {
  copyPrivateVideoToPublishedAsset,
  deletePublishedVideoAssetOrQueue,
} from './published-video-asset.service';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPath,
} from './video-storage-path';

interface PrivateVideoDocument {
  path?: unknown;
  url?: unknown;
  thumbnailPath?: unknown;
  thumbnailUrl?: unknown;
  processedStoragePath?: unknown;
  playbackPath?: unknown;
  processedMimeType?: unknown;
  mimeType?: unknown;
  processedSizeBytes?: unknown;
  sizeBytes?: unknown;
  durationMs?: unknown;
  status?: unknown;
  replacementState?: unknown;
  replacementPreviousSourceStoragePath?: unknown;
  replacementPreviousPosterStoragePath?: unknown;
  replacementPreviousProcessedStoragePath?: unknown;
  replacementPreviousProcessedOutputPrefix?: unknown;
}

interface VideoPublicationDocument {
  isPublished?: unknown;
  moderationStatus?: unknown;
  sourceStoragePath?: unknown;
  pendingSourceStoragePath?: unknown;
  publishedStoragePath?: unknown;
  publishedPosterStoragePath?: unknown;
}

interface PublicVideoDocument {
  ownerUid?: unknown;
  id?: unknown;
}

export interface PromotePrivateVideoReplacementResponse {
  videoId: string;
  replaced: boolean;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : null;
}

async function rollbackNewPublishedAssets(input: {
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
}): Promise<void> {
  await Promise.all([
    deletePublishedVideoAssetOrQueue({
      ownerUid: input.ownerUid,
      videoId: input.videoId,
      storagePath: input.videoStoragePath,
      assetKind: 'video',
      reason: 'replace-video-publication-rollback',
    }),
    deletePublishedVideoAssetOrQueue({
      ownerUid: input.ownerUid,
      videoId: input.videoId,
      storagePath: input.posterStoragePath,
      assetKind: 'poster',
      reason: 'replace-video-poster-publication-rollback',
    }),
  ]);
}

async function cleanupPreviousPublishedAssets(input: {
  ownerUid: string;
  videoId: string;
  previousVideoStoragePath: string | null;
  previousPosterStoragePath: string | null;
  currentVideoStoragePath: string;
  currentPosterStoragePath: string | null;
}): Promise<void> {
  const tasks: Promise<boolean>[] = [];

  if (
    input.previousVideoStoragePath &&
    input.previousVideoStoragePath !== input.currentVideoStoragePath
  ) {
    tasks.push(deletePublishedVideoAssetOrQueue({
      ownerUid: input.ownerUid,
      videoId: input.videoId,
      storagePath: input.previousVideoStoragePath,
      assetKind: 'video',
      reason: 'replace-video-published-version',
    }));
  }

  if (
    input.previousPosterStoragePath &&
    input.previousPosterStoragePath !== input.currentPosterStoragePath
  ) {
    tasks.push(deletePublishedVideoAssetOrQueue({
      ownerUid: input.ownerUid,
      videoId: input.videoId,
      storagePath: input.previousPosterStoragePath,
      assetKind: 'poster',
      reason: 'replace-video-published-poster',
    }));
  }

  await Promise.all(tasks);
}

/**
 * Troca os ativos públicos somente depois que a nova versão privada está
 * pronta. Métricas, ordem, data de publicação, comentários, reações e links
 * permanecem associados ao mesmo documento público e ao mesmo `videoId`.
 */
export async function promotePrivateVideoReplacement(
  rawOwnerUid: unknown,
  rawVideoId: unknown
): Promise<PromotePrivateVideoReplacementResponse> {
  const ownerUid = cleanId(rawOwnerUid);
  const videoId = cleanId(rawVideoId);

  if (!ownerUid || !videoId) {
    throw new HttpsError('invalid-argument', 'Vídeo inválido.');
  }

  const privateVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const publicVideoRef = db.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const [privateSnapshot, publicationSnapshot, publicSnapshot] =
    await Promise.all([
      privateVideoRef.get(),
      publicationRef.get(),
      publicVideoRef.get(),
    ]);

  if (
    !privateSnapshot.exists ||
    !publicationSnapshot.exists ||
    !publicSnapshot.exists
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A publicação atual não está disponível para substituição.'
    );
  }

  const video = privateSnapshot.data() as PrivateVideoDocument;
  const publication =
    publicationSnapshot.data() as VideoPublicationDocument;
  const publicVideo = publicSnapshot.data() as PublicVideoDocument;
  const currentSourceStoragePath =
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url);
  const currentPosterStoragePath =
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailPath
    ) ??
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailUrl
    );
  const processedStoragePath =
    normalizeOwnedProcessedVideoPath(
      ownerUid,
      videoId,
      video.processedStoragePath
    ) ??
    normalizeOwnedProcessedVideoPath(
      ownerUid,
      videoId,
      video.playbackPath
    );
  const publishedSourceStoragePath = extractOwnedPrivateVideoPathForId(
    ownerUid,
    videoId,
    publication.sourceStoragePath
  );
  const pendingSourceStoragePath = extractOwnedPrivateVideoPathForId(
    ownerUid,
    videoId,
    publication.pendingSourceStoragePath
  );
  const status = String(video.status ?? '').trim().toLowerCase();
  const replacementState = String(video.replacementState ?? '')
    .trim()
    .toUpperCase();

  if (
    cleanId(publicVideo.ownerUid) !== ownerUid ||
    cleanId(publicVideo.id ?? videoId) !== videoId ||
    publication.isPublished !== true ||
    String(publication.moderationStatus ?? '').trim().toUpperCase() !==
      'APPROVED'
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A publicação atual não pode receber uma nova versão.'
    );
  }

  if (
    currentSourceStoragePath &&
    publishedSourceStoragePath === currentSourceStoragePath &&
    !pendingSourceStoragePath
  ) {
    return { videoId, replaced: false };
  }

  if (
    !currentSourceStoragePath ||
    !processedStoragePath ||
    status !== 'ready' ||
    replacementState !== 'PROCESSING' ||
    pendingSourceStoragePath !== currentSourceStoragePath
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A nova versão ainda não está pronta para publicação.'
    );
  }

  const previousPublishedVideoStoragePath = String(
    publication.publishedStoragePath ?? ''
  ).trim() || null;
  const previousPublishedPosterStoragePath = String(
    publication.publishedPosterStoragePath ?? ''
  ).trim() || null;
  const previousPrivateSourceStoragePath =
    extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      video.replacementPreviousSourceStoragePath
    );
  const previousPrivatePosterStoragePath =
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.replacementPreviousPosterStoragePath
    );
  const previousPrivateProcessedStoragePath =
    normalizeOwnedProcessedVideoPath(
      ownerUid,
      videoId,
      video.replacementPreviousProcessedStoragePath
    );
  const previousPrivateProcessedOutputPrefix = String(
    video.replacementPreviousProcessedOutputPrefix ?? ''
  ).trim() || (
    previousPrivateProcessedStoragePath
      ? previousPrivateProcessedStoragePath.replace(/[^/]+$/, '')
      : null
  );
  const publishedAssets = await copyPrivateVideoToPublishedAsset({
    ownerUid,
    videoId,
    sourceVideoStoragePath: currentSourceStoragePath,
    sourcePosterStoragePath: currentPosterStoragePath,
  });
  const now = Date.now();
  const durationMs = normalizePositiveInteger(video.durationMs);
  const batch = db.batch();

  batch.set(
    publicationRef,
    {
      sourceStoragePath: currentSourceStoragePath,
      pendingSourceStoragePath: FieldValue.delete(),
      publishedStoragePath: publishedAssets.videoStoragePath,
      publishedPosterStoragePath:
        publishedAssets.posterStoragePath ?? FieldValue.delete(),
      assetVersion: now,
      updatedAt: now,
    },
    { merge: true }
  );
  batch.set(
    publicVideoRef,
    {
      assetAccess: 'SIGNED_URL',
      posterAccess: publishedAssets.posterStoragePath
        ? 'SIGNED_URL'
        : 'NONE',
      url: FieldValue.delete(),
      posterUrl: FieldValue.delete(),
      mimeType: publishedAssets.videoContentType,
      sizeBytes: publishedAssets.sizeBytes,
      durationMs,
      updatedAt: now,
    },
    { merge: true }
  );
  batch.set(
    privateVideoRef,
    {
      replacementState: 'COMPLETED',
      replacementCompletedAt: now,
      replacementPreviousSourceStoragePath: FieldValue.delete(),
      replacementPreviousPosterStoragePath: FieldValue.delete(),
      replacementPreviousProcessedStoragePath: FieldValue.delete(),
      replacementPreviousProcessedOutputPrefix: FieldValue.delete(),
      updatedAt: now,
    },
    { merge: true }
  );

  try {
    await batch.commit();
  } catch (error) {
    await rollbackNewPublishedAssets({
      ownerUid,
      videoId,
      videoStoragePath: publishedAssets.videoStoragePath,
      posterStoragePath: publishedAssets.posterStoragePath,
    });
    throw error;
  }

  await Promise.all([
    cleanupPreviousPublishedAssets({
      ownerUid,
      videoId,
      previousVideoStoragePath: previousPublishedVideoStoragePath,
      previousPosterStoragePath: previousPublishedPosterStoragePath,
      currentVideoStoragePath: publishedAssets.videoStoragePath,
      currentPosterStoragePath: publishedAssets.posterStoragePath,
    }),
    cleanupReplacedPrivateVideoAssetsOrQueue({
      ownerUid,
      videoId,
      sourceStoragePath: previousPrivateSourceStoragePath,
      posterStoragePath: previousPrivatePosterStoragePath,
      processedOutputPrefix: previousPrivateProcessedOutputPrefix,
    }),
  ]);

  return { videoId, replaced: true };
}
