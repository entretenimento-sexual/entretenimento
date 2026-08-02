// functions/src/chat/direct-chat/domain/direct-message-public-video-reference.policy.ts
// -----------------------------------------------------------------------------
// Referência segura de vídeo publicado em mensagens diretas.
//
// A mensagem persiste somente identidade e metadado público mínimo. URL
// assinada, caminho de Storage e tokens de acesso nunca pertencem ao chat.
// A audiência do remetente e do destinatário é validada separadamente pelo
// VideoAudiencePolicy antes da criação da mensagem.
// -----------------------------------------------------------------------------

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SHAREABLE_VISIBILITIES = new Set([
  'PUBLIC',
  'COMPATIBLE',
  'FRIENDS',
  'SUBSCRIBERS',
  'PREMIUM',
]);

export interface RequestedPublicVideoReference {
  ownerUid: string;
  videoId: string;
}

export interface PublicVideoDocumentForDirectShare {
  id?: unknown;
  ownerUid?: unknown;
  mediaType?: unknown;
  assetAccess?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
  title?: unknown;
}

export interface VideoPublicationDocumentForDirectShare {
  ownerUid?: unknown;
  videoId?: unknown;
  isPublished?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
}

export interface StoredDirectMessagePublicVideoReference {
  kind: 'PUBLIC_VIDEO';
  ownerUid: string;
  videoId: string;
  title: string;
}

function normalizeId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function replaceControlCharacters(value: string): string {
  let sanitized = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    sanitized += code <= 31 || code === 127 ? ' ' : value[index];
  }

  return sanitized;
}

function normalizeTitle(value: unknown): string {
  const normalized = replaceControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return normalized || 'Vídeo compartilhado';
}

export function normalizeRequestedPublicVideoReference(
  value: unknown
): RequestedPublicVideoReference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    ownerUid?: unknown;
    videoId?: unknown;
  };
  const ownerUid = normalizeId(candidate.ownerUid);
  const videoId = normalizeId(candidate.videoId);

  return ownerUid && videoId ? { ownerUid, videoId } : null;
}

export function resolveStoredDirectMessagePublicVideoReference(params: {
  requested: RequestedPublicVideoReference;
  publicProfileExists: boolean;
  publicVideo: PublicVideoDocumentForDirectShare | undefined;
  publication: VideoPublicationDocumentForDirectShare | undefined;
}): StoredDirectMessagePublicVideoReference | null {
  const { requested, publicProfileExists, publicVideo, publication } = params;

  if (!publicProfileExists || !publicVideo || !publication) {
    return null;
  }

  const videoId = normalizeId(publicVideo.id);
  const videoOwnerUid = normalizeId(publicVideo.ownerUid);
  const publicationOwnerUid = normalizeId(publication.ownerUid);
  const publicationVideoId = normalizeId(publication.videoId);
  const projectionVisibility = normalizeEnum(publicVideo.visibility);
  const publicationVisibility = normalizeEnum(publication.visibility);
  const projectionModeration = normalizeEnum(publicVideo.moderationStatus);
  const publicationModeration = normalizeEnum(publication.moderationStatus);

  if (
    videoId !== requested.videoId ||
    videoOwnerUid !== requested.ownerUid ||
    publicationOwnerUid !== requested.ownerUid ||
    publicationVideoId !== requested.videoId ||
    normalizeEnum(publicVideo.mediaType) !== 'VIDEO' ||
    normalizeEnum(publicVideo.assetAccess) !== 'SIGNED_URL' ||
    !SHAREABLE_VISIBILITIES.has(projectionVisibility) ||
    projectionVisibility !== publicationVisibility ||
    projectionModeration !== 'APPROVED' ||
    projectionModeration !== publicationModeration ||
    publication.isPublished !== true
  ) {
    return null;
  }

  return {
    kind: 'PUBLIC_VIDEO',
    ownerUid: requested.ownerUid,
    videoId: requested.videoId,
    title: normalizeTitle(publicVideo.title),
  };
}
