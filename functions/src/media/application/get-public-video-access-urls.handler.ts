import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  resolveBlockedTargetUids,
} from '../../friendship/application/bilateral-block-access.policy';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import {
  normalizePublicVideoAccessMode,
  shouldIssuePublicVideoPlaybackAccess,
  type TPublicVideoAccessMode,
} from './public-video-access-mode';
import {
  consumePublicVideoAccessQuota,
} from './public-video-access-rate-limit.service';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';
import {
  normalizeOwnedPublishedVideoPath,
  normalizeOwnedPublishedVideoPosterPath,
} from './video-storage-path';

interface PublicVideoAccessRequestItem {
  ownerUid?: string;
  videoId?: string;
}

interface PublicVideoAccessRequest {
  items?: PublicVideoAccessRequestItem[];
  mode?: TPublicVideoAccessMode;
}

interface PublicVideoAccessResponseItem {
  ownerUid: string;
  videoId: string;
  url: string | null;
  posterUrl: string | null;
  expiresAt: number;
}

interface PublicVideoAccessResponse {
  items: PublicVideoAccessResponseItem[];
}

interface PublicVideoAccessResolution {
  item: PublicVideoAccessResponseItem | null;
  technicalFailure: boolean;
}

interface PublicProfileAccessResolution {
  exists: boolean;
  technicalFailure: boolean;
}

const MAX_ITEMS_PER_REQUEST = 16;
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

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
  return JSON.stringify([ownerUid, videoId]);
}

async function resolveAccessItem(
  ownerUid: string,
  videoId: string,
  expiresAt: number,
  publicProfileExists: boolean,
  mode: TPublicVideoAccessMode
): Promise<PublicVideoAccessResponseItem | null> {
  if (!publicProfileExists) {
    return null;
  }

  const publicVideoRef = db.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const [publicVideoSnap, publicationSnap] = await Promise.all([
    publicVideoRef.get(),
    publicationRef.get(),
  ]);

  if (!publicVideoSnap.exists || !publicationSnap.exists) {
    return null;
  }

  const publicVideo = publicVideoSnap.data();
  const publication = publicationSnap.data();

  if (
    publicVideo?.visibility !== 'PUBLIC' ||
    publicVideo?.moderationStatus !== 'APPROVED' ||
    publication?.isPublished !== true
  ) {
    return null;
  }

  const videoStoragePath = normalizeOwnedPublishedVideoPath(
    ownerUid,
    videoId,
    publication?.publishedStoragePath
  );

  if (!videoStoragePath) {
    return null;
  }

  let url: string | null = null;

  if (shouldIssuePublicVideoPlaybackAccess(mode)) {
    const videoFile = storage.bucket().file(videoStoragePath);
    const [videoExists] = await videoFile.exists();

    if (!videoExists) {
      throw new Error(
        'O ativo publicado do vídeo não foi encontrado no Storage.'
      );
    }

    url = await createTemporaryStorageReadUrl(videoStoragePath, expiresAt);
  }

  const posterStoragePath = normalizeOwnedPublishedVideoPosterPath(
    ownerUid,
    videoId,
    publication?.publishedPosterStoragePath
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

  return {
    ownerUid,
    videoId,
    url,
    posterUrl,
    expiresAt,
  };
}

export const getPublicVideoAccessUrls = onCall<PublicVideoAccessRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request): Promise<PublicVideoAccessResponse> => {
    assertPublicMediaCallableAppCheck(request.app);

    const viewerUid = cleanId(request.auth?.uid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const rawItems = Array.isArray(request.data?.items)
      ? request.data.items
      : [];
    const mode = normalizePublicVideoAccessMode(request.data?.mode);

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

    /**
     * A quota é ponderada pelos itens realmente únicos e consumida antes das
     * leituras de compliance, perfil, publicação e Storage. PREVIEW e PLAYBACK
     * dividem a mesma quota para impedir alternância de modo como bypass.
     */
    await consumePublicVideoAccessQuota(viewerUid, uniqueItems.size);

    /**
     * Esta Function é a barreira definitiva antes de emitir URL assinada.
     * O Router protege a UX, mas não é fronteira de segurança: lifecycle,
     * termos vigentes, consentimento adulto e reverificação etária são
     * validados novamente no backend a cada emissão/renovação.
     *
     * MANUTENÇÃO — RESTRIÇÃO FUTURA POR ASSINATURA/AUDIÊNCIA
     * Quando FRIENDS, SUBSCRIBERS ou PREMIUM forem ativados, esta policy deve
     * ser estendida com amizade/entitlement vigentes. Compartilhar um link ou
     * uma referência no chat nunca concede acesso por si só.
     */
    await assertPublicMediaConsumptionAccess(viewerUid);

    const ownerUids = [
      ...new Set([...uniqueItems.values()].map(({ ownerUid }) => ownerUid)),
    ];
    let blockedOwnerUids: Set<string>;

    try {
      blockedOwnerUids = await resolveBlockedTargetUids(viewerUid, ownerUids);
    } catch (error) {
      logger.warn(
        '[getPublicVideoAccessUrls] Falha ao validar bloqueios bilaterais.',
        {
          viewerUid,
          ownerCount: ownerUids.length,
          error: error instanceof Error
            ? error.message
            : String(error ?? ''),
        }
      );

      throw new HttpsError(
        'internal',
        'Não foi possível validar o acesso aos vídeos neste momento.'
      );
    }

    const ownerProfileEntries = await Promise.all(
      ownerUids.map(async (ownerUid) => {
        if (blockedOwnerUids.has(ownerUid)) {
          return [
            ownerUid,
            { exists: false, technicalFailure: false },
          ] as const;
        }

        try {
          const snapshot = await db.doc(`public_profiles/${ownerUid}`).get();
          return [
            ownerUid,
            { exists: snapshot.exists, technicalFailure: false },
          ] as const;
        } catch (error) {
          logger.warn(
            '[getPublicVideoAccessUrls] Falha ao validar perfil público.',
            {
              ownerUid,
              error: error instanceof Error
                ? error.message
                : String(error ?? ''),
            }
          );

          return [
            ownerUid,
            { exists: false, technicalFailure: true },
          ] as const;
        }
      })
    );
    const publicProfileAccessByOwner = new Map<
      string,
      PublicProfileAccessResolution
    >(ownerProfileEntries);
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    const resolutions = await Promise.all(
      [...uniqueItems.values()].map(
        async ({ ownerUid, videoId }): Promise<PublicVideoAccessResolution> => {
          const profileAccess = publicProfileAccessByOwner.get(ownerUid);

          if (profileAccess?.technicalFailure === true) {
            return { item: null, technicalFailure: true };
          }

          try {
            return {
              item: await resolveAccessItem(
                ownerUid,
                videoId,
                expiresAt,
                profileAccess?.exists === true,
                mode
              ),
              technicalFailure: false,
            };
          } catch (error) {
            logger.warn('[getPublicVideoAccessUrls] Falha ao gerar acesso.', {
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
