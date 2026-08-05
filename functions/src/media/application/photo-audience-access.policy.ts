import {
  assertVideoAudienceAccessDecision,
  type VideoAudienceAccessDecision,
  type VideoAudienceAccessTarget,
  type VideoAudienceAction,
} from './video-audience-access.policy';

export type PhotoAudienceAction = VideoAudienceAction;

export interface PublicPhotoAudienceDocument {
  readonly id?: unknown;
  readonly ownerUid?: unknown;
  readonly mediaType?: unknown;
  readonly assetAccess?: unknown;
  readonly visibility?: unknown;
  readonly moderationStatus?: unknown;
}

export interface PhotoPublicationAudienceDocument {
  readonly ownerUid?: unknown;
  readonly photoId?: unknown;
  readonly isPublished?: unknown;
  readonly visibility?: unknown;
  readonly moderationStatus?: unknown;
}

const SUPPORTED_VISIBILITIES = new Set([
  'PRIVATE',
  'PUBLIC',
  'COMPATIBLE',
  'FRIENDS',
  'SUBSCRIBERS',
  'PREMIUM',
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

function normalizeVisibility(value: unknown): string | null {
  const normalized = normalizeEnum(value);
  return SUPPORTED_VISIBILITIES.has(normalized) ? normalized : null;
}

export function resolveCanonicalPhotoAudienceTarget(params: {
  readonly ownerUid: unknown;
  readonly photoId: unknown;
  readonly action: PhotoAudienceAction;
  readonly publicPhoto: PublicPhotoAudienceDocument | null | undefined;
  readonly publication: PhotoPublicationAudienceDocument | null | undefined;
}): VideoAudienceAccessTarget | null {
  const ownerUid = cleanId(params.ownerUid);
  const photoId = cleanId(params.photoId);
  const publicPhoto = params.publicPhoto;
  const publication = params.publication;

  if (!ownerUid || !photoId || !publicPhoto || !publication) {
    return null;
  }

  const projectionVisibility = normalizeVisibility(publicPhoto.visibility);
  const publicationVisibility = normalizeVisibility(publication.visibility);
  const projectionModeration = normalizeEnum(publicPhoto.moderationStatus);
  const publicationModeration = normalizeEnum(publication.moderationStatus);

  if (
    cleanId(publicPhoto.id) !== photoId ||
    cleanId(publicPhoto.ownerUid) !== ownerUid ||
    cleanId(publication.ownerUid) !== ownerUid ||
    cleanId(publication.photoId) !== photoId ||
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
    action: params.action,
    visibility: publicationVisibility,
    isPublished: publication.isPublished === true,
    moderationStatus: publicationModeration,
  };
}

export function assertPhotoAudienceAccessDecision(
  decision: VideoAudienceAccessDecision,
  action: PhotoAudienceAction
): void {
  assertVideoAudienceAccessDecision(decision, action);
}
