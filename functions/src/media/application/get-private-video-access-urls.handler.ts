import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  normalizePrivateVideoAccessMode,
  shouldIssuePrivateVideoPlaybackAccess,
  type PrivateVideoAccessMode,
} from './private-video-access-mode';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPath,
} from './video-storage-path';

interface PrivateVideoAccessRequest {
  ownerUid?: string;
  videoIds?: string[];
  mode?: PrivateVideoAccessMode;
}

interface PrivateVideoAccessResponseItem {
  videoId: string;
  url: string | null;
  posterUrl: string | null;
  playbackPath: string | null;
  posterPath: string | null;
  expiresAt: number;
}

interface PrivateVideoAccessResponse {
  items: PrivateVideoAccessResponseItem[];
}

interface PrivateVideoDocument {
  path?: string;
  url?: string;
  status?: string;
  playbackPath?: string | null;
  processedStoragePath?: string | null;
  thumbnailPath?: string | null;
  thumbnailUrl?: string | null;
}

const MAX_ITEMS_PER_REQUEST = 60;
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
    return '';
  }

  return normalized;
}

async function resolvePosterAccess(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument,
  expiresAt: number
): Promise<{ posterUrl: string | null; posterPath: string | null }> {
  const posterPath =
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

  if (!posterPath) {
    return { posterUrl: null, posterPath: null };
  }

  const posterFile = storage.bucket().file(posterPath);
  const [posterExists] = await posterFile.exists();

  if (!posterExists) {
    return { posterUrl: null, posterPath };
  }

  return {
    posterUrl: await createTemporaryStorageReadUrl(posterPath, expiresAt),
    posterPath,
  };
}

async function resolvePlaybackPath(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): Promise<string | null> {
  const rawPath =
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url);
  const processedPath =
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
  const playbackPath =
    String(video.status ?? '').trim().toLowerCase() === 'ready' && processedPath
      ? processedPath
      : rawPath;

  if (!playbackPath) {
    return null;
  }

  const playbackFile = storage.bucket().file(playbackPath);
  const [playbackExists] = await playbackFile.exists();

  if (!playbackExists) {
    throw new Error('O arquivo privado do vídeo não foi encontrado.');
  }

  return playbackPath;
}

async function resolveAccessItem(
  ownerUid: string,
  videoId: string,
  expiresAt: number,
  mode: PrivateVideoAccessMode
): Promise<PrivateVideoAccessResponseItem | null> {
  const videoSnap = await db
    .doc(`users/${ownerUid}/videos/${videoId}`)
    .get();

  if (!videoSnap.exists) {
    return null;
  }

  const video = videoSnap.data() as PrivateVideoDocument;
  const posterAccess = await resolvePosterAccess(
    ownerUid,
    videoId,
    video,
    expiresAt
  );

  if (!shouldIssuePrivateVideoPlaybackAccess(mode)) {
    return {
      videoId,
      url: null,
      posterUrl: posterAccess.posterUrl,
      playbackPath: null,
      posterPath: posterAccess.posterPath,
      expiresAt,
    };
  }

  const playbackPath = await resolvePlaybackPath(ownerUid, videoId, video);

  if (!playbackPath) {
    return null;
  }

  return {
    videoId,
    url: await createTemporaryStorageReadUrl(playbackPath, expiresAt),
    posterUrl: posterAccess.posterUrl,
    playbackPath,
    posterPath: posterAccess.posterPath,
    expiresAt,
  };
}

export const getPrivateVideoAccessUrls = onCall<PrivateVideoAccessRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PrivateVideoAccessResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const mode = normalizePrivateVideoAccessMode(request.data?.mode);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || ownerUid !== requesterUid) {
      throw new HttpsError(
        'permission-denied',
        'Você só pode acessar os vídeos do próprio perfil.'
      );
    }

    const rawVideoIds = Array.isArray(request.data?.videoIds)
      ? request.data.videoIds
      : [];
    const videoIds = [...new Set(rawVideoIds.map(cleanId).filter(Boolean))];

    if (!videoIds.length || videoIds.length > MAX_ITEMS_PER_REQUEST) {
      throw new HttpsError(
        'invalid-argument',
        `Informe entre 1 e ${MAX_ITEMS_PER_REQUEST} vídeos.`
      );
    }

    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    const resolutions = await Promise.all(
      videoIds.map(async (videoId) => {
        try {
          return {
            item: await resolveAccessItem(ownerUid, videoId, expiresAt, mode),
            technicalFailure: false,
          };
        } catch (error) {
          logger.warn('[getPrivateVideoAccessUrls] Falha ao gerar acesso.', {
            ownerUid,
            videoId,
            mode,
            error: error instanceof Error
              ? error.message
              : String(error ?? ''),
          });

          return {
            item: null,
            technicalFailure: true,
          };
        }
      })
    );
    const items = resolutions.flatMap((resolution) =>
      resolution.item ? [resolution.item] : []
    );
    const technicalFailureCount = resolutions.filter(
      (resolution) => resolution.technicalFailure
    ).length;

    if (!items.length && technicalFailureCount > 0) {
      throw new HttpsError(
        'internal',
        mode === 'PREVIEW'
          ? 'Não foi possível carregar as capas dos vídeos neste momento.'
          : 'Não foi possível liberar seus vídeos neste momento.'
      );
    }

    return { items };
  }
);
