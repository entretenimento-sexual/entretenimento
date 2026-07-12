import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import {
  copyPrivateVideoToPublishedAsset,
  deletePublishedVideoAssetOrQueue,
} from './published-video-asset.service';
import {
  extractOwnedPrivateVideoPath,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

type VideoVisibility = 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
type ModerationStatus = 'PENDING_REVIEW' | 'APPROVED';
type PublishedVideoAssets = Awaited<
  ReturnType<typeof copyPrivateVideoToPublishedAsset>
>;

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
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
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
  process.env.FUNCTIONS_EMULATOR === 'true' ||
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

async function cleanupReplacedPublishedAssets(
  ownerUid: string,
  videoId: string,
  previousPublication: VideoPublicationDoc | null,
  currentVideoStoragePath: string,
  currentPosterStoragePath: string | null
): Promise<void> {
  const previousVideoStoragePath = previousPublication?.publishedStoragePath;
  const previousPosterStoragePath =
    previousPublication?.publishedPosterStoragePath;
  const cleanupTasks: Promise<boolean>[] = [];

  if (
    previousVideoStoragePath &&
    previousVideoStoragePath !== currentVideoStoragePath
  ) {
    cleanupTasks.push(
      deletePublishedVideoAssetOrQueue({
        ownerUid,
        videoId,
        storagePath: previousVideoStoragePath,
        assetKind: 'video',
        reason: 'replace-published-video-version',
      })
    );
  }

  if (
    previousPosterStoragePath &&
    previousPosterStoragePath !== currentPosterStoragePath
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
    deletePublishedVideoAssetOrQueue({
      ownerUid,
      videoId,
      storagePath: publishedAssets.videoStoragePath,
      assetKind: 'video',
      reason: 'publish-video-firestore-rollback',
    }),
    deletePublishedVideoAssetOrQueue({
      ownerUid,
      videoId,
      storagePath: publishedAssets.posterStoragePath,
      assetKind: 'poster',
      reason: 'publish-video-poster-firestore-rollback',
    }),
  ]);
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
    assertPublishableVideo(privateVideo);

    const sourceVideoStoragePath =
      extractOwnedPrivateVideoPath(ownerUid, privateVideo.path) ??
      extractOwnedPrivateVideoPath(ownerUid, privateVideo.url);

    if (!sourceVideoStoragePath) {
      throw new HttpsError(
        'failed-precondition',
        'O vídeo não possui um arquivo privado válido para publicação.'
      );
    }

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
      logger.error('[publishVideo] Falha ao preparar ativo publicado.', {
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
        publishedStoragePath: publishedAssets.videoStoragePath,
        publishedPosterStoragePath:
          publishedAssets.posterStoragePath ?? FieldValue.delete(),
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

    const previousPublication = previousPublicationSnap.exists
      ? (previousPublicationSnap.data() as VideoPublicationDoc)
      : null;

    await cleanupReplacedPublishedAssets(
      ownerUid,
      videoId,
      previousPublication,
      publishedAssets.videoStoragePath,
      publishedAssets.posterStoragePath
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
        assetVersion: FieldValue.delete(),
      },
      { merge: true }
    );
    batch.delete(publicVideoRef);
    await batch.commit();

    await Promise.all([
      deletePublishedVideoAssetOrQueue({
        ownerUid,
        videoId,
        storagePath: publication?.publishedStoragePath,
        assetKind: 'video',
        reason: 'unpublish-video',
      }),
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
