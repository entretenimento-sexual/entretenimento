import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { evaluateCanonicalAgeEligibility } from '../../compliance/age-eligibility.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import { resolveSocialConnectionAccess } from '../../friendship/application/social-connection-access.policy';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  canReadPublishedPhotoAudience,
} from './photo-audience-access.policy';
import {
  containsControlCharacter,
  normalizeOwnedPublishedPhotoPath,
} from './photo-storage-path';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import {
  publicAgeProjectionValidUntilMs,
  resolvePublicMediaSignedUrlExpiresAt,
} from './public-media-age-expiry.policy';
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
  validUntilMs: number | null;
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
  technicalExpiresAt: number,
  viewerExpiresAt: number,
  ownerExpiresAt: number,
  publicProfileExists: boolean,
  viewerIsOwner: boolean,
  viewerIsFriend: boolean
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
  const visibility = String(publicPhoto?.visibility ?? '')
    .trim()
    .toUpperCase();

  const mediaValidUntilMs =
    publicAgeProjectionValidUntilMs(publicPhoto);

  if (
    mediaValidUntilMs === null ||
    mediaValidUntilMs <= Date.now() ||
    !canReadPublishedPhotoAudience({
      visibility,
      viewerIsOwner,
      viewerIsFriend,
    }) ||
    publicPhoto?.moderationStatus !== 'APPROVED' ||
    publication?.isPublished !== true ||
    String(publication?.visibility ?? '').trim().toUpperCase() !== visibility
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

  const expiresAt = resolvePublicMediaSignedUrlExpiresAt({
    nowMs: Date.now(),
    technicalExpiresAtMs: technicalExpiresAt,
    viewerExpiresAtMs: viewerExpiresAt,
    ownerExpiresAtMs: ownerExpiresAt,
    mediaExpiresAtMs: mediaValidUntilMs,
  });

  if (expiresAt === null) {
    return null;
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
    const viewerAccess =
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
        '[getPublicPhotoAccessUrls] Falha ao validar relação social.',
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
        if (socialAccess.blockedTargetUids.has(ownerUid)) {
          return [
            ownerUid,
            {
              exists: false,
              technicalFailure: false,
              validUntilMs: null,
            },
          ] as const;
        }

        try {
          const [profileSnapshot, ageEligibilitySnapshot] =
            await Promise.all([
              db.doc(`public_profiles/${ownerUid}`).get(),
              db.doc(`age_eligibility_records/${ownerUid}`).get(),
            ]);
          const profileValidUntilMs =
            profileSnapshot.exists
              ? publicAgeProjectionValidUntilMs(profileSnapshot.data())
              : null;
          const ownerAgeDecision = evaluateCanonicalAgeEligibility({
            uid: ownerUid,
            rawRecord: ageEligibilitySnapshot.exists
              ? ageEligibilitySnapshot.data()
              : null,
            nowMs,
          });
          const ownerCanonicalValidUntilMs =
            ownerAgeDecision.allowed
              ? ownerAgeDecision.expiresAtMs ?? Number.POSITIVE_INFINITY
              : null;
          const validUntilMs =
            profileValidUntilMs !== null &&
            ownerCanonicalValidUntilMs !== null
              ? Math.min(
                  profileValidUntilMs,
                  ownerCanonicalValidUntilMs
                )
              : null;

          return [
            ownerUid,
            {
              exists:
                validUntilMs !== null &&
                validUntilMs > nowMs,
              technicalFailure: false,
              validUntilMs,
            },
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
            {
              exists: false,
              technicalFailure: true,
              validUntilMs: null,
            },
          ] as const;
        }
      })
    );
    const publicProfileAccessByOwner = new Map<
      string,
      PublicProfileAccessResolution
    >(ownerProfileEntries);
    const technicalExpiresAt = nowMs + SIGNED_URL_TTL_MS;
    const viewerExpiresAt =
      viewerAccess.ageEligibilityExpiresAtMs ??
      Number.POSITIVE_INFINITY;
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
                technicalExpiresAt,
                viewerExpiresAt,
                profileAccess?.validUntilMs ??
                  Number.NEGATIVE_INFINITY,
                profileAccess?.exists === true,
                ownerUid === viewerUid,
                socialAccess.friendTargetUids.has(ownerUid)
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
