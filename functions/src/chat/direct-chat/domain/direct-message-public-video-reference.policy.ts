// functions/src/chat/direct-chat/domain/direct-message-public-video-reference.policy.ts
// -----------------------------------------------------------------------------
// Referência segura de vídeo público em mensagens diretas.
//
// A mensagem persiste somente identidade e metadado público mínimo. URL
// assinada, caminho de Storage e tokens de acesso nunca pertencem ao chat.
// -----------------------------------------------------------------------------

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface RequestedPublicVideoReference {
  ownerUid: string;
  videoId: string;
}

export interface PublicVideoDocumentForDirectShare {
  ownerUid?: unknown;
  mediaType?: unknown;
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

function normalizeTitle(value: unknown): string {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
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

/**
 * MANUTENÇÃO — RESTRIÇÃO FUTURA POR ASSINATURA/AUDIÊNCIA
 *
 * Hoje a referência direta aceita somente vídeo PUBLIC + APPROVED. Quando
 * FRIENDS, SUBSCRIBERS ou PREMIUM forem ativados, esta decisão deverá receber
 * o UID do destinatário e validar amizade/entitlement vigente. O envio da
 * referência jamais concede acesso: o playback deve revalidar a audiência
 * novamente, inclusive após cancelamento ou mudança do plano.
 */
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

  const videoOwnerUid = normalizeId(publicVideo.ownerUid);
  const publicationOwnerUid = normalizeId(publication.ownerUid);
  const publicationVideoId = normalizeId(publication.videoId);

  if (
    videoOwnerUid !== requested.ownerUid ||
    publicationOwnerUid !== requested.ownerUid ||
    publicationVideoId !== requested.videoId ||
    publicVideo.mediaType !== 'VIDEO' ||
    publicVideo.visibility !== 'PUBLIC' ||
    publicVideo.moderationStatus !== 'APPROVED' ||
    publication.isPublished !== true ||
    publication.visibility !== 'PUBLIC' ||
    publication.moderationStatus !== 'APPROVED'
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
