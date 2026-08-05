import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertAccountOperationalAccess,
} from '../../account_lifecycle/account-operational-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  extractOwnedPrivatePhotoPath,
} from './photo-storage-path';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';

interface PrivatePhotoAccessRequest {
  readonly ownerUid?: unknown;
  readonly photoIds?: unknown;
}

interface PrivatePhotoAccessResponseItem {
  readonly photoId: string;
  readonly url: string;
  readonly storagePath: string;
  readonly expiresAt: number;
}

interface PrivatePhotoAccessResponse {
  readonly items: PrivatePhotoAccessResponseItem[];
}

interface PrivatePhotoDocument {
  readonly id?: unknown;
  readonly path?: unknown;
  readonly url?: unknown;
}

const MAX_ITEMS_PER_REQUEST = 60;
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

async function resolveAccessItem(
  ownerUid: string,
  photoId: string,
  expiresAt: number
): Promise<PrivatePhotoAccessResponseItem | null> {
  const photoSnapshot = await db
    .doc(`users/${ownerUid}/photos/${photoId}`)
    .get();

  if (!photoSnapshot.exists) {
    return null;
  }

  const photo = photoSnapshot.data() as PrivatePhotoDocument;
  const documentPhotoId = cleanId(photo.id ?? photoSnapshot.id);

  if (documentPhotoId !== photoId) {
    return null;
  }

  const storagePath =
    extractOwnedPrivatePhotoPath(ownerUid, photo.path) ??
    extractOwnedPrivatePhotoPath(ownerUid, photo.url);

  if (!storagePath) {
    return null;
  }

  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new Error('O arquivo privado da foto não foi encontrado.');
  }

  return {
    photoId,
    url: await createTemporaryStorageReadUrl(storagePath, expiresAt),
    storagePath,
    expiresAt,
  };
}

export const getPrivatePhotoAccessUrls = onCall<PrivatePhotoAccessRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PrivatePhotoAccessResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || ownerUid !== requesterUid) {
      throw new HttpsError(
        'permission-denied',
        'Você só pode acessar as fotos do próprio perfil.'
      );
    }

    await assertAccountOperationalAccess(
      requesterUid,
      'MEDIA_VIEW_PRIVATE'
    );

    const rawPhotoIds = Array.isArray(request.data?.photoIds)
      ? request.data.photoIds
      : [];
    const photoIds = [
      ...new Set(rawPhotoIds.map(cleanId).filter(Boolean)),
    ];

    if (!photoIds.length || photoIds.length > MAX_ITEMS_PER_REQUEST) {
      throw new HttpsError(
        'invalid-argument',
        `Informe entre 1 e ${MAX_ITEMS_PER_REQUEST} fotos.`
      );
    }

    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    const resolutions = await Promise.all(
      photoIds.map(async (photoId) => {
        try {
          return {
            item: await resolveAccessItem(ownerUid, photoId, expiresAt),
            technicalFailure: false,
          };
        } catch (error) {
          logger.warn('[getPrivatePhotoAccessUrls] Falha ao gerar acesso.', {
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
        'Não foi possível liberar suas fotos neste momento.'
      );
    }

    return { items };
  }
);
