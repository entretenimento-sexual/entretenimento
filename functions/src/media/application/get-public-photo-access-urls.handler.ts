import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import { normalizeOwnedPublishedPhotoPath } from './photo-storage-path';

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
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return '';
  }

  return normalized;
}

function buildRequestKey(ownerUid: string, photoId: string): string {
  return `${ownerUid}:${photoId}`;
}

function buildStorageEmulatorUrl(storagePath: string): string {
  const configuredHost = String(
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199'
  ).trim();
  const baseUrl = /^https?:\/\//i.test(configuredHost)
    ? configuredHost
    : `http://${configuredHost}`;
  const bucketName = storage.bucket().name;
  const encodedBucket = encodeURIComponent(bucketName);
  const encodedPath = encodeURIComponent(storagePath);

  return `${baseUrl}/v0/b/${encodedBucket}/o/${encodedPath}?alt=media`;
}

async function resolveAccessItem(
  ownerUid: string,
  photoId: string,
  expiresAt: number
): Promise<PublicPhotoAccessResponseItem | null> {
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

  const url = process.env.FUNCTIONS_EMULATOR === 'true'
    ? buildStorageEmulatorUrl(storagePath)
    : (
        await file.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: expiresAt,
        })
      )[0];

  return {
    ownerUid,
    photoId,
    url,
    expiresAt,
  };
}

export const getPublicPhotoAccessUrls = onCall<PublicPhotoAccessRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PublicPhotoAccessResponse> => {
    if (!request.auth?.uid) {
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

    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    const resolutions = await Promise.all(
      [...uniqueItems.values()].map(
        async ({ ownerUid, photoId }): Promise<PublicPhotoAccessResolution> => {
          try {
            return {
              item: await resolveAccessItem(ownerUid, photoId, expiresAt),
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
