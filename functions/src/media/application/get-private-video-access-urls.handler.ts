import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPath,
} from './video-storage-path';

interface PrivateVideoAccessRequest {
  ownerUid?: string;
  videoIds?: string[];
}

interface PrivateVideoAccessResponseItem {
  videoId: string;
  url: string;
  posterUrl: string | null;
  playbackPath: string;
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

function buildStorageEmulatorUrl(storagePath: string): string {
  const configuredHost = String(
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199'
  ).trim();
  const baseUrl = /^https?:\/\//i.test(configuredHost)
    ? configuredHost
    : `http://${configuredHost}`;
  const bucketName = storage.bucket().name;

  return (
    `${baseUrl}/v0/b/${encodeURIComponent(bucketName)}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media`
  );
}

async function createTemporaryReadUrl(
  storagePath: string,
  expiresAt: number
): Promise<string> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return buildStorageEmulatorUrl(storagePath);
  }

  const [signedUrl] = await storage
    .bucket()
    .file(storagePath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });

  return signedUrl;
}

async function resolveAccessItem(
  ownerUid: string,
  videoId: string,
  expiresAt: number
): Promise<PrivateVideoAccessResponseItem | null> {
  const videoSnap = await db
    .doc(`users/${ownerUid}/videos/${videoId}`)
    .get();

  if (!videoSnap.exists) {
    return null;
  }

  const video = videoSnap.data() as PrivateVideoDocument;
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
  let playbackPath = rawPath;

  if (
    String(video.status ?? '').trim().toLowerCase() === 'ready' &&
    processedPath
  ) {
    playbackPath = processedPath;
  }

  if (!playbackPath) {
    return null;
  }

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
  const playbackFile = storage.bucket().file(playbackPath);
  const [playbackExists] = await playbackFile.exists();

  if (!playbackExists) {
    throw new Error('O arquivo privado do vídeo não foi encontrado.');
  }

  let posterUrl: string | null = null;

  if (posterPath) {
    const posterFile = storage.bucket().file(posterPath);
    const [posterExists] = await posterFile.exists();

    if (posterExists) {
      posterUrl = await createTemporaryReadUrl(posterPath, expiresAt);
    }
  }

  return {
    videoId,
    url: await createTemporaryReadUrl(playbackPath, expiresAt),
    posterUrl,
    playbackPath,
    posterPath,
    expiresAt,
  };
}

export const getPrivateVideoAccessUrls = onCall<PrivateVideoAccessRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PrivateVideoAccessResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);

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
            item: await resolveAccessItem(ownerUid, videoId, expiresAt),
            technicalFailure: false,
          };
        } catch (error) {
          logger.warn('[getPrivateVideoAccessUrls] Falha ao gerar acesso.', {
            ownerUid,
            videoId,
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
        'Não foi possível liberar seus vídeos neste momento.'
      );
    }

    return { items };
  }
);
