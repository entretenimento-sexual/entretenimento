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
  defaultVideoPublicationModerationStatus,
  isRestrictedVideoModerationStatus,
} from './video-publication-moderation.policy';
import {
  extractOwnedPrivateVideoPath,
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

type VideoVisibility = 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
type ModerationStatus = 'APPROVED';
type PublishedVideoAssets = Awaited<
  ReturnType<typeof copyPrivateVideoToPublishedAsset>
>;

type OwnerVideoDoc = {
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

function assertPublishableVideo(ownerVideo: OwnerVideoDoc): void {
  const status = String(ownerVideo.status ?? '').trim().toLowerCase();
  const mimeType = String(ownerVideo.mimeType ?? '').trim().toLowerCase();
  const durationMs = normalizeOptionalPositiveInteger(ownerVideo.durationMs);

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

function assertPublicationCanStart(
  publication: VideoPublicationDoc | null
): void {
  if (publication?.isPublished === true) {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo já está publicado.'
    );
  }

  if (isRestrictedVideoModerationStatus(publication?.moderationStatus)) {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo possui uma restrição de moderação ativa.'
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
    const ownerVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const [ownerVideoSnap, previousPublicationSnap] = await Promise.all([
      ownerVideoRef.get(),
      publicationRef.get(),
    ]);

    if (!ownerVideoSnap.exists) {
      throw new HttpsError('not-found', 'Vídeo não encontrado.');
    }

    const ownerVideo = ownerVideoSnap.data() as OwnerVideoDoc;
    const previousPublication = previousPublicationSnap.exists
      ? (previousPublicationSnap.data() as VideoPublicationDoc)
      : null;
    assertPublishableVideo(ownerVideo);
    assertPublicationCanStart(previousPublication);

    const sourceVideoStoragePath =
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, ownerVideo.path) ??
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, ownerVideo.url) ??
      extractOwnedPrivateVideoPath(ownerUid, ownerVideo.path) ??
      extractOwnedPrivateVideoPath(ownerUid, ownerVideo.url);

    if (!sourceVideoStoragePath) {
      throw new HttpsError(
        'failed-precondition',
        'O vídeo não possui um arquivo-fonte protegido válido para publicação.'
      );
    }

    assertSourceWasNotRejected(previousPublication, sourceVideoStoragePath);

    const sourcePosterStoragePath =
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        ownerVideo.thumbnailPath
      ) ??
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        ownerVideo.thumbnailUrl
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
    const moderationStatus = defaultVideoPublicationModerationStatus();
    const durationMs = normalizeOptionalPositiveInteger(
      ownerVideo.durationMs
    );
    const batch = db.batch();

    batch.set(
      publicationRef,
      {
        ownerUid,
        videoId,
        isPublished: true,
        publishWhenReady: false,
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
        lastModeratedAt: FieldValue.delete(),
        sourceStoragePath: sourceVideoStoragePath,
        rejectedSourceStoragePath: FieldValue.delete(),
        moderatedBy: FieldValue.delete(),
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
          ownerVideo.fileName ?? 'Vídeo do perfil'
        ).slice(0, 160),
        alt: 'Vídeo publicado no perfil',
        mimeType: publishedAssets.videoContentType,
        sizeBytes: publishedAssets.sizeBytes,
        durationMs,
        createdAt: normalizeCreatedAt(ownerVideo.createdAt),
        publishedAt: now,
        updatedAt: now,
        assetVersion: now,
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