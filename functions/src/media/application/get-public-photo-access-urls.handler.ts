import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  containsControlCharacter,
  normalizeOwnedPublishedPhotoPath,
} from './photo-storage-path';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';
import {
  createVideoAudienceAccessEvaluator,
  type VideoAudienceAccessEvaluator,
} from './video-audience-access.policy';

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

const MAX_ITEMS_PER_REQUEST = 32;
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

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

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function buildRequestKey(ownerUid: string, photoId: string): string {
  return `${ownerUid}:${photoId}`;
}

async function resolveAccessItem(
  audience: VideoAudienceAccessEvaluator,
  ownerUid: string,
  photoId: string,
  expiresAt: number
): Promise<PublicPhotoAccessResponseItem | null> {
  const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
  const publicPhotoRef = db.doc(
    `public_profiles/${ownerUid}/public_photos/${photoId}`
  );
  const publicationRef = db.doc(
    `users/${ownerUid}/photo_publications/${photoId}`
  );
  const [publicProfileSnap, publicPhotoSnap, publicationSnap] =
    await Promise.all([
      publicProfileRef.get(),
      publicPhotoRef.get(),
      publicationRef.get(),
    ]);

  if (
    !publicProfileSnap.exists ||
    !publicPhotoSnap.exists ||
    !publicationSnap.exists
  ) {
    return null;
  }

  const publicPhoto = publicPhotoSnap.data();
  const publication = publicationSnap.data();
  const projectionVisibility = normalizeEnum(publicPhoto?.visibility);
  const publicationVisibility = normalizeEnum(publication?.visibility);
  const projectionModeration = normalizeEnum(publicPhoto?.moderationStatus);
  const publicationModeration = normalizeEnum(publication?.moderationStatus);

  /**
   * A projeção pública não autoriza acesso isoladamente. Identidade, tipo,
   * estratégia de ativo, visibilidade e moderação precisam coincidir com a
   * publicação canônica antes da avaliação de audiência.
   */
  if (
    cleanId(publicPhoto?.id) !== photoId ||
    cleanId(publicPhoto?.ownerUid) !== ownerUid ||
    cleanId(publication?.photoId) !== photoId ||
    cleanId(publication?.ownerUid) !== ownerUid ||
    normalizeEnum(publicPhoto?.mediaType) !== 'PHOTO' ||
    normalizeEnum(publicPhoto?.assetAccess) !== 'SIGNED_URL' ||
    !projectionVisibility ||
    projectionVisibility !== publicationVisibility ||
    !projectionModeration ||
    projectionModeration !== publicationModeration
  ) {
    return null;
  }

  const audienceDecision = await audience.evaluate({
    ownerUid,
    action: 'PLAY',
    visibility: publicationVisibility,
    isPublished: publication?.isPublished === true,
    moderationStatus: publicationModeration,
  });

  if (!audienceDecision.allowed) {
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
  { region: FUNCTIONS_REGION },
  async (request): Promise<PublicPhotoAccessResponse> => {
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

    const audience = await createVideoAudienceAccessEvaluator(viewerUid);
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    const resolutions = await Promise.all(
      [...uniqueItems.values()].map(
        async ({ ownerUid, photoId }): Promise<PublicPhotoAccessResolution> => {
          try {
            return {
              item: await resolveAccessItem(
                audience,
                ownerUid,
                photoId,
                expiresAt
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
