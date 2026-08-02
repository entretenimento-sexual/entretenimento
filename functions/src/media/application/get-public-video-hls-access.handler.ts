import { posix } from 'node:path';

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  getPublicVideoAccessUrls as getPublicVideoAccessUrlsCore,
} from './get-public-video-access-urls.handler';
import {
  buildPublicVideoHlsBundle,
  type PublicVideoHlsPlaylist,
} from './public-video-hls-manifest.service';
import { normalizeOwnedProcessedVideoPath } from './video-storage-path';

interface PublicVideoHlsAccessRequest {
  ownerUid?: string;
  videoId?: string;
}

interface PublicVideoHlsAccessResponse {
  ownerUid: string;
  videoId: string;
  masterManifest: string;
  playlists: PublicVideoHlsPlaylist[];
  expiresAt: number;
}

interface BasePublicVideoAccessResponse {
  items?: Array<{
    ownerUid?: string;
    videoId?: string;
  }>;
}

interface PrivateVideoDocument {
  processedHlsManifestStoragePath?: unknown;
  processingStage?: unknown;
  processingPipelineVersion?: unknown;
}

const HLS_ACCESS_TTL_MS = 30 * 60 * 1000;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? 'unknown'))
    .trim()
    .slice(0, 500);
}

async function assertBasePlaybackAccess(
  request: Parameters<typeof getPublicVideoAccessUrlsCore.run>[0],
  ownerUid: string,
  videoId: string
): Promise<void> {
  const response = (
    await getPublicVideoAccessUrlsCore.run({
      ...request,
      data: {
        items: [{ ownerUid, videoId }],
      },
    } as Parameters<typeof getPublicVideoAccessUrlsCore.run>[0])
  ) as BasePublicVideoAccessResponse;
  const authorized = response.items?.some((item) =>
    cleanId(item.ownerUid) === ownerUid && cleanId(item.videoId) === videoId
  ) === true;

  if (!authorized) {
    throw new HttpsError(
      'not-found',
      'O vídeo não está disponível para este perfil.'
    );
  }
}

/**
 * Emite os manifests HLS reescritos somente quando o usuário inicia o player.
 * O feed continua recebendo apenas MP4s temporários, evitando assinar centenas
 * de segmentos para vídeos que talvez nunca sejam reproduzidos.
 */
export const getPublicVideoHlsAccess = onCall<PublicVideoHlsAccessRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PublicVideoHlsAccessResponse> => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    await assertBasePlaybackAccess(request, ownerUid, videoId);

    const videoSnapshot = await db
      .doc(`users/${ownerUid}/videos/${videoId}`)
      .get();

    if (!videoSnapshot.exists) {
      throw new HttpsError('not-found', 'Vídeo não encontrado.');
    }

    const video = videoSnapshot.data() as PrivateVideoDocument;
    const processingStage = String(video.processingStage ?? '')
      .trim()
      .toLowerCase();
    const masterStoragePath = normalizeOwnedProcessedVideoPath(
      ownerUid,
      videoId,
      video.processedHlsManifestStoragePath
    );

    if (
      processingStage !== 'delivery_ready' ||
      !masterStoragePath ||
      posix.basename(masterStoragePath).toLowerCase() !== 'manifest.m3u8'
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Este vídeo ainda não possui streaming adaptativo disponível.'
      );
    }

    const expiresAt = Date.now() + HLS_ACCESS_TTL_MS;

    try {
      const bundle = await buildPublicVideoHlsBundle({
        masterStoragePath,
        expiresAt,
      });

      logger.info('[getPublicVideoHlsAccess] Sessão HLS autorizada.', {
        viewerUid,
        ownerUid,
        videoId,
        pipelineVersion: String(video.processingPipelineVersion ?? '').trim(),
        playlistCount: bundle.playlistCount,
        segmentCount: bundle.segmentCount,
        expiresAt: bundle.expiresAt,
      });

      return {
        ownerUid,
        videoId,
        masterManifest: bundle.masterManifest,
        playlists: bundle.playlists,
        expiresAt: bundle.expiresAt,
      };
    } catch (error) {
      logger.error('[getPublicVideoHlsAccess] Falha ao preparar sessão HLS.', {
        viewerUid,
        ownerUid,
        videoId,
        error: normalizeErrorMessage(error),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível preparar o streaming adaptativo neste momento.'
      );
    }
  }
);
