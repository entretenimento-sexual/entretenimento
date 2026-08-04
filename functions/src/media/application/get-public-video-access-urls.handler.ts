import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, storage } from '../../firebaseApp';
import { MEDIA_ACCESS_CALLABLE_OPTIONS } from './media-app-check.options';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';
import {
  createVideoAudienceAccessEvaluator,
  resolveCanonicalVideoAudienceTarget,
  type VideoAudienceAccessEvaluator,
} from './video-audience-access.policy';
import {
  VIDEO_PLAYBACK_SESSION_TTL_MS,
  createVideoPlaybackSessionToken,
  hashVideoPlaybackSessionToken,
} from './video-playback-session.policy';
import {
  normalizeOwnedPublishedVideoPath,
  normalizeOwnedPublishedVideoPosterPath,
} from './video-storage-path';

interface PublicVideoAccessRequestItem {
  readonly ownerUid?: string;
  readonly videoId?: string;
}

interface PublicVideoAccessRequest {
  readonly items?: PublicVideoAccessRequestItem[];
}

interface PublicVideoAccessResponseItem {
  readonly ownerUid: string;
  readonly videoId: string;
  readonly url: string;
  readonly posterUrl: string | null;
  readonly expiresAt: number;
  readonly playbackSessionToken: string;
  readonly playbackSessionExpiresAt: number;
}

interface PublicVideoAccessResponse {
  readonly items: PublicVideoAccessResponseItem[];
}

interface PublicVideoAccessResolution {
  readonly item: PublicVideoAccessResponseItem | null;
  readonly technicalFailure: boolean;
}

interface PublicVideoDocument {
  readonly id?: unknown;
  readonly ownerUid?: unknown;
  readonly mediaType?: unknown;
  readonly assetAccess?: unknown;
  readonly visibility?: unknown;
  readonly moderationStatus?: unknown;
}

interface PublicationDocument {
  readonly ownerUid?: unknown;
  readonly videoId?: unknown;
  readonly isPublished?: unknown;
  readonly visibility?: unknown;
  readonly moderationStatus?: unknown;
  readonly publishedStoragePath?: unknown;
  readonly publishedPosterStoragePath?: unknown;
}

const MAX_ITEMS_PER_REQUEST = 16;
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
const PLAYBACK_SESSIONS_COLLECTION = 'media_video_playback_sessions';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/')
  ) {
    return '';
  }

  return normalized;
}

function buildRequestKey(ownerUid: string, videoId: string): string {
  return `${ownerUid}:${videoId}`;
}

async function issuePlaybackSession(params: {
  readonly viewerUid: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly appId: string | null;
  readonly now: number;
}): Promise<{ token: string; expiresAt: number }> {
  const token = createVideoPlaybackSessionToken();
  const tokenHash = hashVideoPlaybackSessionToken(token);
  const expiresAt = params.now + VIDEO_PLAYBACK_SESSION_TTL_MS;

  await db.collection(PLAYBACK_SESSIONS_COLLECTION).doc(tokenHash).create({
    viewerUid: params.viewerUid,
    ownerUid: params.ownerUid,
    videoId: params.videoId,
    appId: params.appId,
    issuedAt: params.now,
    expiresAt,
    consumedAt: null,
  });

  return { token, expiresAt };
}

async function resolveAccessItem(
  audience: VideoAudienceAccessEvaluator,
  viewerUid: string,
  appId: string | null,
  ownerUid: string,
  videoId: string,
  expiresAt: number,
  now: number
): Promise<PublicVideoAccessResponseItem | null> {
  const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
  const publicVideoRef = db.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const [publicProfileSnapshot, publicVideoSnapshot, publicationSnapshot] =
    await Promise.all([
      publicProfileRef.get(),
      publicVideoRef.get(),
      publicationRef.get(),
    ]);

  if (
    !publicProfileSnapshot.exists ||
    !publicVideoSnapshot.exists ||
    !publicationSnapshot.exists
  ) {
    return null;
  }

  const publicVideo = publicVideoSnapshot.data() as PublicVideoDocument;
  const publication = publicationSnapshot.data() as PublicationDocument;
  const target = resolveCanonicalVideoAudienceTarget({
    ownerUid,
    videoId,
    action: 'PLAY',
    publicVideo,
    publication,
  });

  if (!target || !(await audience.evaluate(target)).allowed) {
    return null;
  }

  const videoStoragePath = normalizeOwnedPublishedVideoPath(
    ownerUid,
    videoId,
    publication.publishedStoragePath
  );

  if (!videoStoragePath) {
    return null;
  }

  const videoFile = storage.bucket().file(videoStoragePath);
  const [videoExists] = await videoFile.exists();

  if (!videoExists) {
    throw new Error(
      'O ativo publicado do vídeo não foi encontrado no Storage.'
    );
  }

  const posterStoragePath = normalizeOwnedPublishedVideoPosterPath(
    ownerUid,
    videoId,
    publication.publishedPosterStoragePath
  );
  let posterUrl: string | null = null;

  if (posterStoragePath) {
    const posterFile = storage.bucket().file(posterStoragePath);
    const [posterExists] = await posterFile.exists();

    if (posterExists) {
      posterUrl = await createTemporaryStorageReadUrl(
        posterStoragePath,
        expiresAt
      );
    }
  }

  const playbackSession = await issuePlaybackSession({
    viewerUid,
    ownerUid,
    videoId,
    appId,
    now,
  });

  return {
    ownerUid,
    videoId,
    url: await createTemporaryStorageReadUrl(videoStoragePath, expiresAt),
    posterUrl,
    expiresAt,
    playbackSessionToken: playbackSession.token,
    playbackSessionExpiresAt: playbackSession.expiresAt,
  };
}

export const getPublicVideoAccessUrls = onCall<PublicVideoAccessRequest>(
  MEDIA_ACCESS_CALLABLE_OPTIONS,
  async (request): Promise<PublicVideoAccessResponse> => {
    const viewerUid = cleanId(request.auth?.uid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const rawItems = Array.isArray(request.data?.items)
      ? request.data.items
      : [];

    if (!rawItems.length || rawItems.length > MAX_ITEMS_PER_REQUEST) {
      throw new HttpsError(
        'invalid-argument',
        `Informe entre 1 e ${MAX_ITEMS_PER_REQUEST} vídeos.`
      );
    }

    const uniqueItems = new Map<
      string,
      { ownerUid: string; videoId: string }
    >();

    for (const item of rawItems) {
      const ownerUid = cleanId(item?.ownerUid);
      const videoId = cleanId(item?.videoId);

      if (!ownerUid || !videoId) {
        continue;
      }

      uniqueItems.set(buildRequestKey(ownerUid, videoId), {
        ownerUid,
        videoId,
      });
    }

    if (!uniqueItems.size) {
      throw new HttpsError(
        'invalid-argument',
        'Nenhum vídeo válido informado.'
      );
    }

    const audience = await createVideoAudienceAccessEvaluator(
      viewerUid,
      request.auth?.token?.email_verified === true
    );
    const now = Date.now();
    const expiresAt = now + SIGNED_URL_TTL_MS;
    const appId = cleanId(request.app?.appId) || null;
    const resolutions = await Promise.all(
      [...uniqueItems.values()].map(
        async ({ ownerUid, videoId }): Promise<PublicVideoAccessResolution> => {
          try {
            return {
              item: await resolveAccessItem(
                audience,
                viewerUid,
                appId,
                ownerUid,
                videoId,
                expiresAt,
                now
              ),
              technicalFailure: false,
            };
          } catch (error) {
            logger.warn('[getPublicVideoAccessUrls] Falha ao gerar acesso.', {
              viewerUid,
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
        }
      )
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
        'Não foi possível liberar os vídeos neste momento.'
      );
    }

    return { items };
  }
);
