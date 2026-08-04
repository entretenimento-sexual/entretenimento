// functions/src/chat/direct-chat/domain/direct-message-public-video-reference.policy.ts
// -----------------------------------------------------------------------------
// Referência segura de vídeo em mensagens diretas.
//
// A mensagem persiste somente identidade e um rótulo genérico. URL assinada,
// título mutável, caminho de Storage e tokens de acesso nunca pertencem ao chat.
// O envio e o playback devem revalidar a audiência no backend.
// -----------------------------------------------------------------------------

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const GENERIC_VIDEO_TITLE = 'Vídeo compartilhado';

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

/**
 * A política central de audiência decide se o remetente pode compartilhar e se
 * o destinatário pode reproduzir. Esta função somente persiste uma referência
 * mínima quando ambas as decisões já foram aprovadas e os documentos canônicos
 * permanecem coerentes.
 */
export function resolveStoredDirectMessagePublicVideoReference(params: {
  requested: RequestedPublicVideoReference;
  publicProfileExists: boolean;
  publicVideo: PublicVideoDocumentForDirectShare | undefined;
  publication: VideoPublicationDocumentForDirectShare | undefined;
  senderAuthorized: boolean;
  recipientAuthorized: boolean;
}): StoredDirectMessagePublicVideoReference | null {
  const {
    requested,
    publicProfileExists,
    publicVideo,
    publication,
    senderAuthorized,
    recipientAuthorized,
  } = params;

  if (
    !senderAuthorized ||
    !recipientAuthorized ||
    !publicProfileExists ||
    !publicVideo ||
    !publication
  ) {
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
    publication.isPublished !== true ||
    !projectionVisibility ||
    projectionVisibility !== publicationVisibility ||
    projectionVisibility === 'PRIVATE' ||
    projectionModeration !== 'APPROVED' ||
    projectionModeration !== publicationModeration
  ) {
    return null;
  }

  return {
    kind: 'PUBLIC_VIDEO',
    ownerUid: requested.ownerUid,
    videoId: requested.videoId,
    title: GENERIC_VIDEO_TITLE,
  };
}
