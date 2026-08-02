import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import {
  copyPrivateVideoToPublishedAsset,
  deletePublishedVideoAssetOrQueue,
  type PublishedVideoAssetResult,
  type PublishedVideoVariantAsset,
} from './published-video-asset.service';
import {
  extractOwnedPrivateVideoPath,
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedPublishedVideoPath,
} from './video-storage-path';

type VideoVisibility = 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
type ModerationStatus = 'PENDING_REVIEW' | 'APPROVED';
type PublishedVideoAssets = PublishedVideoAssetResult;

type PrivateVideoDoc = {
  id?: string;
  url?: string;
  path?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  thumbnailUrl?: string;
  thumbnailPath?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
};

type VideoPublicationDoc = {
  isPublished?: boolean;
  moderationStatus?: string;
  sourceStoragePath?: string;
  rejectedSourceStoragePath?: string;
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
  publishedVariants?: unknown;
  publishedDefaultQuality?: unknown;
};

interface PublishVideoRequest {
  ownerUid?: string;
  videoId?: string;
  visibility?: VideoVisibility;
  orderIndex?: number;
}

interface PublishVideoResponse {
  videoId: string;
  moderationStatus: ModerationStatus;
}

interface UnpublishVideoRequest {
  ownerUid?: string;
  videoId?: string;
}

const AUTO_APPROVE_VIDEOS =
  process.env.MEDIA_AUTO_APPROVE_VIDEOS === 'true';
const PUBLIC_VIDEO_CONTENT_TYPES = new Set(['video/mp4', 'video/webm']);

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    containsControlCharacter(normalized)
  ) {
    return '';
  }

  return normalized;
}

function cleanVisibility(value: unknown): VideoVisibility {
  const text = String(value ?? '').trim().toUpperCase();

  if (
    text === 'FRIENDS' ||
    text === 'SUBSCRIBERS' ||
    text === 'PREMIUM' ||
    text === 'PUBLIC'
  ) {
    return text;
  }

  return 'PUBLIC';
}

function normalizeOrderIndex(value: unknown): number {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.min(10_000, Math.trunc(numberValue)));
}

function normalizeCreatedAt(value: unknown): number {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : Date.now();
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return Math.trunc(numberValue);
}

function resolveModerationStatus(): ModerationStatus {
  return AUTO_APPROVE_VIDEOS ? 'APPROVED' : 'PENDING_REVIEW';
}

function assertOwner(requesterUid: string | null, ownerUid: string): void {
  if (!requesterUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (requesterUid !== ownerUid) {
    throw new HttpsError(
      'permission-denied',
      'Você só pode publicar vídeos do seu próprio perfil.'
    );
  }
}

function assertPublishableVideo(privateVideo: PrivateVideoDoc): void {
  const status = String(privateVideo.status ?? '').trim().toLowerCase();
  const mimeType = String(privateVideo.mimeType ?? '').trim().toLowerCase();
  const durationMs = normalizeOptionalPositiveInteger(privateVideo.durationMs);

  if (status !== 'ready') {
    throw new HttpsError(
      'failed-precondition',
      'O vídeo precisa estar pronto antes da publicação.'
    );
  }

  if (!PUBLIC_VIDEO_CONTENT_TYPES.has(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'Publique apenas vídeos MP4 ou WebM compatíveis.'
    );
  }

  if (!durationMs) {
    throw new HttpsError(
      'failed-precondition',
      'A duração do vídeo não foi confirmada.'
    );
  }
}

function assertSourceWasNotRejected(
  publication: VideoPublicationDoc | null,
  sourceStoragePath: string
): void {
  const rejectedSourceStoragePath = String(
    publication?.rejectedSourceStoragePath ?? ''
  ).trim();

  if (rejectedSourceStoragePath === sourceStoragePath) {
    throw new HttpsError(
      'failed-precondition',
      'Este arquivo foi rejeitado pela moderação. Exclua-o e envie uma nova versão.'
    );
  }
}

function normalizePublishedVariantPaths(
  ownerUid: string,
  videoId: string,
  publication: VideoPublicationDoc | null
): string[] {
  const paths = new Set<string>();
  const legacyPath = normalizeOwnedPublishedVideoPath(
    ownerUid,
    videoId,
    publication?.publishedStoragePath
  );

  if (legacyPath) {
    paths.add(legacyPath);
  }

  const rawVariants = Array.isArray(publication?.publishedVariants)
    ? publication.publishedVariants
    : [];

  for (const candidate of rawVariants) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }

    const storagePath = normalizeOwnedPublishedVideoPath(
      ownerUid,
      videoId,
      (candidate as { storagePath?: unknown }).storagePath
    );

    if (storagePath) {
      paths.add(storagePath);
    }
  }

  return [...paths];
}

async function cleanupReplacedPublishedAssets(
  ownerUid: string,
  videoId: string,
  previousPublication: VideoPublicationDoc | null,
  currentAssets: PublishedVideoAssets
): Promise<void> {
  const currentVideoPaths = new Set(
    currentAssets.variants.map((variant) => variant.storagePath)
  );
  const previousVideoPaths = normalizePublishedVariantPaths(
    ownerUid,
    videoId,
    previousPublication
  );
  const cleanupTasks: Promise<boolean>[] = [];

  for (const storagePath of previousVideoPaths) {
    if (!currentVideoPaths.has(storagePath)) {
      cleanupTasks.push(
        deletePublishedVideoAssetOrQueue({
          ownerUid,
          videoId,
          storagePath,
          assetKind: 'video',
          reason: 'replace-published-video-version',
        })
      );
    }
  }

  const previousPosterStoragePath =
    previousPublication?.publishedPosterStoragePath;

  if (
    previousPosterStoragePath &&
    previousPosterStoragePath !== currentAssets.posterStoragePath
  ) {
    cleanupTasks.push(
      deletePublishedVideoAssetOrQueue({
        ownerUid,
        videoId,
        storagePath: previousPosterStoragePath,
        assetKind: 'poster',
        reason: 'replace-published-video-poster',
      })
    );
  }

  await Promise.all(cleanupTasks);
}

async function rollbackPublishedAssets(
  ownerUid: string,
  videoId: string,
  publishedAssets: PublishedVideoAssets
): Promise<void> {
  await Promise.all([
    ...publishedAssets.variants.map((variant) =>
      deletePublishedVideoAssetOrQueue({
        ownerUid,
        videoId,
        storagePath: variant.storagePath,
        assetKind: 'video',
        reason: 'publish-video-firestore-rollback',
      })
    ),
    deletePublishedVideoAssetOrQueue({
      ownerUid,
      videoId,
      storagePath: publishedAssets.posterStoragePath,
      assetKind: 'poster',
      reason: 'publish-video-poster-firestore-rollback',
    }),
  ]);
}

function publicVariantMetadata(
  variants: readonly PublishedVideoVariantAsset[]
): Array<{
  quality: string;
  mimeType: string;
  sizeBytes: number;
}> {
  return variants.map((variant) => ({
    quality: variant.quality,
    mimeType: variant.contentType,
    sizeBytes: variant.sizeBytes,
  }));
}

export const publishVideo = onCall<PublishVideoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PublishVideoResponse> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    assertOwner(requesterUid, ownerUid);

    const visibility = cleanVisibility(request.data?.visibility);
    const orderIndex = normalizeOrderIndex(request.data?.orderIndex);
    const privateVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const [privateVideoSnap, previousPublicationSnap] = await Promise.all([
      privateVideoRef.get(),
      publicationRef.get(),
    ]);

    if (!privateVideoSnap.exists) {
      throw new HttpsError('not-found', 'Vídeo privado não encontrado.');
    }

    const privateVideo = privateVideoSnap.data() as PrivateVideoDoc;
    const previousPublication = previousPublicationSnap.exists
      ? (previousPublicationSnap.data() as VideoPublicationDoc)
      : null;
    assertPublishableVideo(privateVideo);

    const sourceVideoStoragePath =
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, privateVideo.path) ??
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, privateVideo.url) ??
      extractOwnedPrivateVideoPath(ownerUid, privateVideo.path) ??
      extractOwnedPrivateVideoPath(ownerUid, privateVideo.url);

    if (!sourceVideoStoragePath) {
      throw new HttpsError(
        'failed-precondition',
        'O vídeo não possui um arquivo privado válido para publicação.'
      );
    }

    assertSourceWasNotRejected(previousPublication, sourceVideoStoragePath);

    const sourcePosterStoragePath =
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        privateVideo.thumbnailPath
      ) ??
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        privateVideo.thumbnailUrl
      );

    let publishedAssets: PublishedVideoAssets;

    try {
      publishedAssets = await copyPrivateVideoToPublishedAsset({
        ownerUid,
        videoId,
        sourceVideoStoragePath,
        sourcePosterStoragePath,
      });
    } catch (error) {
      logger.error('[publishVideo] Falha ao preparar ativos publicados.', {
        ownerUid,
        videoId,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível preparar o vídeo para publicação.'
      );
    }

    const now = Date.now();
    const moderationStatus = resolveModerationStatus();
    const durationMs = normalizeOptionalPositiveInteger(
      privateVideo.durationMs
    );
    const batch = db.batch();

    batch.set(
      publicationRef,
      {
        ownerUid,
        videoId,
        isPublished: true,
        visibility,
        orderIndex,
        moderationStatus,
        moderationReason: null,
        reportsCount: 0,
        viewsCount: 0,
        uniqueViewersCount: 0,
        score: 0,
        publishedAt: now,
        updatedAt: now,
        lastModeratedAt: moderationStatus === 'APPROVED' ? now : null,
        sourceStoragePath: sourceVideoStoragePath,
        rejectedSourceStoragePath: FieldValue.delete(),
        publishedStoragePath: publishedAssets.videoStoragePath,
        publishedPosterStoragePath:
          publishedAssets.posterStoragePath ?? FieldValue.delete(),
        publishedVariants: publishedAssets.variants,
        publishedDefaultQuality: publishedAssets.defaultQuality,
        assetVersion: now,
      },
      { merge: true }
    );

    batch.set(
      publicVideoRef,
      {
        id: videoId,
        ownerUid,
        mediaType: 'VIDEO',
        assetAccess: 'SIGNED_URL',
        posterAccess: publishedAssets.posterStoragePath
          ? 'SIGNED_URL'
          : 'NONE',
        url: FieldValue.delete(),
        posterUrl: FieldValue.delete(),
        title: String(
          privateVideo.fileName ?? 'Vídeo do perfil'
        ).slice(0, 160),
        alt: 'Vídeo publicado no perfil',
        mimeType: publishedAssets.videoContentType,
        sizeBytes: publishedAssets.sizeBytes,
        availableQualities: publishedAssets.variants.map(
          (variant) => variant.quality
        ),
        defaultQuality: publishedAssets.defaultQuality,
        variants: publicVariantMetadata(publishedAssets.variants),
        durationMs,
        createdAt: normalizeCreatedAt(privateVideo.createdAt),
        publishedAt: now,
        updatedAt: now,
        visibility,
        orderIndex,
        moderationStatus,
        moderationReason: null,
        reportsCount: 0,
        viewsCount: 0,
        uniqueViewersCount: 0,
        score: 0,
      },
      { merge: true }
    );

    try {
      await batch.commit();
    } catch (error) {
      await rollbackPublishedAssets(ownerUid, videoId, publishedAssets);
      throw error;
    }

    await cleanupReplacedPublishedAssets(
      ownerUid,
      videoId,
      previousPublication,
      publishedAssets
    );
    await refreshPublicProfileMediaMetrics(ownerUid);

    return {
      videoId,
      moderationStatus,
    };
  }
);

export const unpublishVideo = onCall<UnpublishVideoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ videoId: string }> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    assertOwner(requesterUid, ownerUid);

    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const publicationSnap = await publicationRef.get();
    const publication = publicationSnap.exists
      ? (publicationSnap.data() as VideoPublicationDoc)
      : null;

    if (publication?.moderationStatus === 'REJECTED') {
      return { videoId };
    }

    const publishedVideoPaths = normalizePublishedVariantPaths(
      ownerUid,
      videoId,
      publication
    );
    const now = Date.now();
    const batch = db.batch();

    batch.set(
      publicationRef,
      {
        ownerUid,
        videoId,
        isPublished: false,
        visibility: 'PRIVATE',
        moderationStatus: 'PRIVATE',
        updatedAt: now,
        sourceStoragePath: FieldValue.delete(),
        publishedStoragePath: FieldValue.delete(),
        publishedPosterStoragePath: FieldValue.delete(),
        publishedVariants: FieldValue.delete(),
        publishedDefaultQuality: FieldValue.delete(),
        assetVersion: FieldValue.delete(),
      },
      { merge: true }
    );
    batch.delete(publicVideoRef);
    await batch.commit();

    await Promise.all([
      ...publishedVideoPaths.map((storagePath) =>
        deletePublishedVideoAssetOrQueue({
          ownerUid,
          videoId,
          storagePath,
          assetKind: 'video',
          reason: 'unpublish-video',
        })
      ),
      deletePublishedVideoAssetOrQueue({
        ownerUid,
        videoId,
        storagePath: publication?.publishedPosterStoragePath,
        assetKind: 'poster',
        reason: 'unpublish-video-poster',
      }),
    ]);
    await refreshPublicProfileMediaMetrics(ownerUid);

    return { videoId };
  }
);
