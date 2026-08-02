import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';
import {
  createVideoAudienceAccessEvaluator,
  type VideoAudienceAccessEvaluator,
} from './video-audience-access.policy';
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
}

type PublicVideoQuality = 'SD' | 'HD';
type PublicVideoMimeType = 'video/mp4' | 'video/webm';

interface PublicVideoAccessVariant {
  quality: PublicVideoQuality;
  url: string;
  mimeType: PublicVideoMimeType;
  sizeBytes: number;
}

interface PublicVideoAccessResponseItem {
  ownerUid: string;
  videoId: string;
  /** Variante padrão preservada para clientes anteriores. */
  url: string;
  posterUrl: string | null;
  variants: PublicVideoAccessVariant[];
  defaultQuality: PublicVideoQuality;
  expiresAt: number;
}

interface PublicVideoAccessResponse {
  items: PublicVideoAccessResponseItem[];
}

interface PublicVideoAccessResolution {
  item: PublicVideoAccessResponseItem | null;
  technicalFailure: boolean;
}

interface PublishedVariantDocument {
  quality?: unknown;
  storagePath?: unknown;
  contentType?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
}

const MAX_ITEMS_PER_REQUEST = 16;
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
const PUBLIC_VIDEO_TYPES = new Set<PublicVideoMimeType>([
  'video/mp4',
  'video/webm',
]);

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

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeQuality(value: unknown): PublicVideoQuality | null {
  const quality = normalizeEnum(value);
  return quality === 'SD' || quality === 'HD' ? quality : null;
}

function normalizeMimeType(value: unknown): PublicVideoMimeType | null {
  const mimeType = String(value ?? '').trim().toLowerCase() as
    PublicVideoMimeType;
  return PUBLIC_VIDEO_TYPES.has(mimeType) ? mimeType : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : null;
}

function buildRequestKey(ownerUid: string, videoId: string): string {
  return `${ownerUid}:${videoId}`;
}

function normalizePublishedVariants(
  ownerUid: string,
  videoId: string,
  publicVideo: Record<string, unknown>,
  publication: Record<string, unknown>
): {
  variants: Array<{
    quality: PublicVideoQuality;
    storagePath: string;
    mimeType: PublicVideoMimeType;
    sizeBytes: number;
  }>;
  defaultQuality: PublicVideoQuality;
} {
  const byQuality = new Map<PublicVideoQuality, {
    quality: PublicVideoQuality;
    storagePath: string;
    mimeType: PublicVideoMimeType;
    sizeBytes: number;
  }>();
  const rawVariants = Array.isArray(publication['publishedVariants'])
    ? publication['publishedVariants']
    : [];

  for (const candidate of rawVariants) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }

    const data = candidate as PublishedVariantDocument;
    const quality = normalizeQuality(data.quality);
    const storagePath = normalizeOwnedPublishedVideoPath(
      ownerUid,
      videoId,
      data.storagePath
    );
    const mimeType = normalizeMimeType(
      data.contentType ?? data.mimeType
    );
    const sizeBytes = normalizePositiveInteger(data.sizeBytes);

    if (quality && storagePath && mimeType && sizeBytes) {
      byQuality.set(quality, {
        quality,
        storagePath,
        mimeType,
        sizeBytes,
      });
    }
  }

  if (!byQuality.size) {
    const storagePath = normalizeOwnedPublishedVideoPath(
      ownerUid,
      videoId,
      publication['publishedStoragePath']
    );
    const mimeType = normalizeMimeType(publicVideo['mimeType']);
    const sizeBytes = normalizePositiveInteger(publicVideo['sizeBytes']);

    if (storagePath && mimeType && sizeBytes) {
      byQuality.set('HD', {
        quality: 'HD',
        storagePath,
        mimeType,
        sizeBytes,
      });
    }
  }

  const variants = [...byQuality.values()].sort((left, right) =>
    left.quality === right.quality
      ? 0
      : left.quality === 'SD'
        ? -1
        : 1
  );

  if (!variants.length) {
    throw new Error('A publicação não possui variantes de vídeo válidas.');
  }

  const requestedDefault = normalizeQuality(
    publication['publishedDefaultQuality'] ?? publicVideo['defaultQuality']
  );
  const defaultQuality = requestedDefault && byQuality.has(requestedDefault)
    ? requestedDefault
    : byQuality.has('HD')
      ? 'HD'
      : 'SD';

  return { variants, defaultQuality };
}

async function resolveAccessItem(
  audienceEvaluator: VideoAudienceAccessEvaluator,
  ownerUid: string,
  videoId: string,
  expiresAt: number
): Promise<PublicVideoAccessResponseItem | null> {
  const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
  const publicVideoRef = db.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const [publicProfileSnap, publicVideoSnap, publicationSnap] =
    await Promise.all([
      publicProfileRef.get(),
      publicVideoRef.get(),
      publicationRef.get(),
    ]);

  if (
    !publicProfileSnap.exists ||
    !publicVideoSnap.exists ||
    !publicationSnap.exists
  ) {
    return null;
  }

  const publicVideo = (publicVideoSnap.data() ?? {}) as
    Record<string, unknown>;
  const publication = (publicationSnap.data() ?? {}) as
    Record<string, unknown>;
  const projectionOwnerUid = cleanId(publicVideo['ownerUid']);
  const projectionVideoId = cleanId(publicVideo['id']);
  const projectionMediaType = normalizeEnum(publicVideo['mediaType']);
  const projectionAssetAccess = normalizeEnum(publicVideo['assetAccess']);
  const projectionVisibility = normalizeEnum(publicVideo['visibility']);
  const publicationVisibility = normalizeEnum(publication['visibility']);
  const projectionModeration = normalizeEnum(publicVideo['moderationStatus']);
  const publicationModeration = normalizeEnum(publication['moderationStatus']);

  if (
    projectionOwnerUid !== ownerUid ||
    projectionVideoId !== videoId ||
    projectionMediaType !== 'VIDEO' ||
    projectionAssetAccess !== 'SIGNED_URL' ||
    !projectionVisibility ||
    projectionVisibility !== publicationVisibility ||
    !projectionModeration ||
    projectionModeration !== publicationModeration
  ) {
    return null;
  }

  const audienceDecision = await audienceEvaluator.evaluate({
    ownerUid,
    action: 'PLAY',
    visibility: publicationVisibility,
    isPublished: publication['isPublished'] === true,
    moderationStatus: publicationModeration,
  });

  if (!audienceDecision.allowed) {
    return null;
  }

  const resolved = normalizePublishedVariants(
    ownerUid,
    videoId,
    publicVideo,
    publication
  );
  const variants: PublicVideoAccessVariant[] = [];

  for (const variant of resolved.variants) {
    const file = storage.bucket().file(variant.storagePath);
    const [exists] = await file.exists();

    if (!exists) {
      throw new Error(
        `A variante ${variant.quality} publicada não foi encontrada no Storage.`
      );
    }

    variants.push({
      quality: variant.quality,
      url: await createTemporaryStorageReadUrl(
        variant.storagePath,
        expiresAt
      ),
      mimeType: variant.mimeType,
      sizeBytes: variant.sizeBytes,
    });
  }

  const defaultVariant = variants.find(
    (variant) => variant.quality === resolved.defaultQuality
  ) ?? variants[0];

  if (!defaultVariant) {
    throw new Error('Nenhuma variante pública pôde ser autorizada.');
  }

  const posterStoragePath = normalizeOwnedPublishedVideoPosterPath(
    ownerUid,
    videoId,
    publication['publishedPosterStoragePath']
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
    url: defaultVariant.url,
    posterUrl,
    variants,
    defaultQuality: defaultVariant.quality,
    expiresAt,
  };
}

export const getPublicVideoAccessUrls = onCall<PublicVideoAccessRequest>(
  { region: FUNCTIONS_REGION },
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

    const audienceEvaluator = await createVideoAudienceAccessEvaluator(
      viewerUid
    );
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    const resolutions = await Promise.all(
      [...uniqueItems.values()].map(
        async ({ ownerUid, videoId }): Promise<PublicVideoAccessResolution> => {
          try {
            return {
              item: await resolveAccessItem(
                audienceEvaluator,
                ownerUid,
                videoId,
                expiresAt
              ),
              technicalFailure: false,
            };
          } catch (error) {
            logger.warn('[getPublicVideoAccessUrls] Falha ao gerar acesso.', {
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
