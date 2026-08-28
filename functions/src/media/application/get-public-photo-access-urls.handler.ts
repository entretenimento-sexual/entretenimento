import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  resolveBlockedTargetUids,
} from '../../friendship/application/bilateral-block-access.policy';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  containsControlCharacter,
  normalizeOwnedPublishedPhotoPath,
} from './photo-storage-path';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';

interface PublicPhotoAccessRequestItem {
  ownerUid?: string;
  photoId?: string;
}

interface PublicPhotoAccessRequest {
  items?: PublicPhotoAccessRequestItem[];
}

interface PublicPhotoAccessResponseItem {
  ownerUid: string;
  photoId: string;
  url: string;
  expiresAt: number;
}

interface PublicPhotoAccessResponse {
  items: PublicPhotoAccessResponseItem[];
}

interface PublicPhotoAccessResolution {
  item: PublicPhotoAccessResponseItem | null;
  technicalFailure: boolean;
}

interface PublicProfileAccessResolution {
  exists: boolean;
  technicalFailure: boolean;
}

const MAX_ITEMS_PER_REQUEST = 32;
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
const PUBLIC_PHOTO_ACCESS_BURST_WINDOW_MS = 60 * 1000;
const PUBLIC_PHOTO_ACCESS_BURST_MAX_ITEMS = 96;
const PUBLIC_PHOTO_ACCESS_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_PHOTO_ACCESS_SUSTAINED_MAX_ITEMS = 480;

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

function buildRequestKey(ownerUid: string, photoId: string): string {
  return JSON.stringify([ownerUid, photoId]);
}

async function consumePublicPhotoAccessQuota(
  viewerUid: string,
  itemCount: number
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'getPublicPhotoAccessUrls',
    subject: viewerUid,
    cost: itemCount,
    config: {
      burstWindowMs: PUBLIC_PHOTO_ACCESS_BURST_WINDOW_MS,
      burstMax: PUBLIC_PHOTO_ACCESS_BURST_MAX_ITEMS,
      sustainedWindowMs: PUBLIC_PHOTO_ACCESS_SUSTAINED_WINDOW_MS,
      sustainedMax: PUBLIC_PHOTO_ACCESS_SUSTAINED_MAX_ITEMS,
    },
    message: 'Muitas fotos foram solicitadas em pouco tempo.',
  });
}

async function resolveAccessItem(
  ownerUid: string,
  photoId: string,
  expiresAt: number,
  publicProfileExists: boolean
): Promise<PublicPhotoAccessResponseItem | null> {
  if (!publicProfileExists) {
    return null;
  }

  const publicPhotoRef = db.doc(
    `public_profiles/${ownerUid}/public_photos/${photoId}`
  );
  const publicationRef = db.doc(
    `users/${ownerUid}/photo_publications/${photoId}`
  );
  const [publicPhotoSnap, publicationSnap] = await Promise.all([
    publicPhotoRef.get(),
    publicationRef.get(),
  ]);

  if (!publicPhotoSnap.exists || !publicationSnap.exists) {
    return null;
  }

  const publicPhoto = publicPhotoSnap.data();
  const publication = publicationSnap.data();

  if (
    publicPhoto?.visibility !== 'PUBLIC' ||
    publicPhoto?.moderationStatus !== 'APPROVED' ||
    publication?.isPublished !== true
  ) {
    return null;
  }

  const storagePath = normalizeOwnedPublishedPhotoPath(
    ownerUid,
    photoId,
    publication?.publishedStoragePath
  );

  if (!storagePath) {
    return null;
  }

  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new Error('O ativo publicado não foi encontrado no Storage.');
  }

  return {
    ownerUid,
    photoId,
    url: await createTemporaryStorageReadUrl(storagePath, expiresAt),
    expiresAt,
  };
}

export const getPublicPhotoAccessUrls = onCall<PublicPhotoAccessRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request): Promise<PublicPhotoAccessResponse> => {
    assertPublicMediaCallableAppCheck(request.app);

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
        `Informe entre 1 e ${MAX_ITEMS_PER_REQUEST} mídias.`
      );
    }

    const uniqueItems = new Map<
      string,
      { ownerUid: string; photoId: string }
    >();

    for (const item of rawItems) {
      const ownerUid = cleanId(item?.ownerUid);
      const photoId = cleanId(item?.photoId);

      if (!ownerUid || !photoId) {
        continue;
      }

      uniqueItems.set(buildRequestKey(ownerUid, photoId), {
        ownerUid,
        photoId,
      });
    }

    if (!uniqueItems.size) {
      throw new HttpsError(
        'invalid-argument',
        'Nenhuma foto válida informada.'
      );
    }

    await consumePublicPhotoAccessQuota(viewerUid, uniqueItems.size);
    await assertPublicMediaConsumptionAccess(viewerUid);

    const ownerUids = [
      ...new Set([...uniqueItems.values()].map(({ ownerUid }) => ownerUid)),
    ];
    let blockedOwnerUids: Set<string>;

    try {
      blockedOwnerUids = await resolveBlockedTargetUids(viewerUid, ownerUids);
    } catch (error) {
      logger.warn(
        '[getPublicPhotoAccessUrls] Falha ao validar bloqueios bilaterais.',
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
        'Não foi possível validar o acesso às fotos neste momento.'
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
            '[getPublicPhotoAccessUrls] Falha ao validar perfil público.',
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
        async ({ ownerUid, photoId }): Promise<PublicPhotoAccessResolution> => {
          const profileAccess = publicProfileAccessByOwner.get(ownerUid);

          if (profileAccess?.technicalFailure === true) {
            return { item: null, technicalFailure: true };
          }

          try {
            return {
              item: await resolveAccessItem(
                ownerUid,
                photoId,
                expiresAt,
                profileAccess?.exists === true
              ),
              technicalFailure: false,
            };
          } catch (error) {
            logger.warn('[getPublicPhotoAccessUrls] Falha ao gerar acesso.', {
              ownerUid,
              photoId,
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
        'Não foi possível liberar as fotos neste momento.'
      );
    }

    return { items };
  }
);
