import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import { resolveSocialConnectionAccess } from '../../friendship/application/social-connection-access.policy';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import {
  resolvePublicMediaSignedOwnerExposure,
  type PublicMediaOwnerExposureContext,
} from './public-media-owner-exposure.service';
import {
  normalizePublicVideoAccessMode,
  type TPublicVideoAccessMode,
} from './public-video-access-mode';
import {
  consumePublicVideoAccessQuota,
} from './public-video-access-rate-limit.service';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';
import {
  resolvePublicVideoSignedAccessItem,
  type PublicVideoSignedAccessItem,
} from './public-video-access-resolution.firestore';

interface PublicVideoAccessRequestItem {
  ownerUid?: string;
  videoId?: string;
}

interface PublicVideoAccessRequest {
  items?: PublicVideoAccessRequestItem[];
  mode?: TPublicVideoAccessMode;
}

interface PublicVideoAccessResponse {
  items: PublicVideoSignedAccessItem[];
}

interface PublicVideoAccessResolution {
  item: PublicVideoSignedAccessItem | null;
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
     * termos, consentimento e Account Access são validados novamente no
     * backend a cada emissão/renovação. Media não interpreta a razão da decisão.
     *
     * MANUTENÇÃO — RESTRIÇÃO FUTURA POR ASSINATURA/AUDIÊNCIA
     * FRIENDS exige amizade recíproca vigente, validada com bloqueios
     * bilaterais. Um link ou referência nunca concede acesso por si só.
     * SUBSCRIBERS e PREMIUM continuam indisponíveis sem entitlement.
     */
    const requesterAccess =
      await assertPublicMediaConsumptionAccess(viewerUid);
    const nowMs = Date.now();

    const ownerUids = [
      ...new Set([...uniqueItems.values()].map(({ ownerUid }) => ownerUid)),
    ];
    let socialAccess: Awaited<ReturnType<typeof resolveSocialConnectionAccess>>;

    try {
      socialAccess = await resolveSocialConnectionAccess(viewerUid, ownerUids);
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

    let publicProfileAccessByOwner:
      ReadonlyMap<string, PublicMediaOwnerExposureContext>;

    try {
      publicProfileAccessByOwner = await resolvePublicMediaSignedOwnerExposure(
        ownerUids,
        socialAccess.blockedTargetUids,
        nowMs
      );
    } catch (error) {
      logger.warn(
        '[getPublicVideoAccessUrls] Falha ao validar exposure dos proprietários.',
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

    const technicalExpiresAt = nowMs + SIGNED_URL_TTL_MS;
    const resolutions = await Promise.all(
      [...uniqueItems.values()].map(
        async ({ ownerUid, videoId }): Promise<PublicVideoAccessResolution> => {
          const profileAccess = publicProfileAccessByOwner.get(ownerUid);

          try {
            return {
              item: await resolvePublicVideoSignedAccessItem(
                db,
                {
                  ownerUid,
                  videoId,
                  technicalExpiresAt,
                  requesterAccessExpiresAtMs: requesterAccess.accessExpiresAtMs,
                  ownerAccessExpiresAtMs:
                    profileAccess?.accountAccessExpiresAtMs ?? null,
                  ownerExposureAllowed: profileAccess?.allowed === true,
                  viewerCanReadFriends:
                    ownerUid === viewerUid ||
                    socialAccess.friendTargetUids.has(ownerUid),
                  mode,
                  nowMs,
                },
                {
                  fileExists: async (path) => {
                    const [exists] = await storage.bucket().file(path).exists();
                    return exists;
                  },
                  createReadUrl: createTemporaryStorageReadUrl,
                }
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
