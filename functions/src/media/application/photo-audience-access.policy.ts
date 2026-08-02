import type {
  VideoAudienceAccessTarget,
} from './video-audience-access.policy';

export interface PublicPhotoAudienceDocument {
  id?: unknown;
  ownerUid?: unknown;
  mediaType?: unknown;
  assetAccess?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
}

export interface PhotoPublicationAudienceDocument {
  ownerUid?: unknown;
  photoId?: unknown;
  isPublished?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  return normalized &&
    normalized.length <= 128 &&
    !normalized.includes('/')
    ? normalized
    : '';
}

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Resolve a projeção pública e a publicação privada como um único alvo.
 * Qualquer divergência fecha o acesso antes de consultar relações ou emitir URL.
 */
export function resolveCanonicalPhotoAudienceTarget(params: {
  ownerUid: unknown;
  photoId: unknown;
  publicPhoto: PublicPhotoAudienceDocument | null | undefined;
  publication: PhotoPublicationAudienceDocument | null | undefined;
}): VideoAudienceAccessTarget | null {
  const ownerUid = cleanId(params.ownerUid);
  const photoId = cleanId(params.photoId);
  const publicPhoto = params.publicPhoto;
  const publication = params.publication;

  if (!ownerUid || !photoId || !publicPhoto || !publication) {
    return null;
  }

  const projectionVisibility = normalizeEnum(publicPhoto.visibility);
  const publicationVisibility = normalizeEnum(publication.visibility);
  const projectionModeration = normalizeEnum(publicPhoto.moderationStatus);
  const publicationModeration = normalizeEnum(publication.moderationStatus);

  if (
    cleanId(publicPhoto.id) !== photoId ||
    cleanId(publicPhoto.ownerUid) !== ownerUid ||
    cleanId(publication.photoId) !== photoId ||
    cleanId(publication.ownerUid) !== ownerUid ||
    normalizeEnum(publicPhoto.mediaType) !== 'PHOTO' ||
    normalizeEnum(publicPhoto.assetAccess) !== 'SIGNED_URL' ||
    !projectionVisibility ||
    projectionVisibility !== publicationVisibility ||
    !projectionModeration ||
    projectionModeration !== publicationModeration
  ) {
    return null;
  }

  return {
    ownerUid,
    action: 'PLAY',
    visibility: publicationVisibility,
    isPublished: publication.isPublished === true,
    moderationStatus: publicationModeration,
  };
}
