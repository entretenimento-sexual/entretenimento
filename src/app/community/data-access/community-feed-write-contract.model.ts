// src/app/community/data-access/community-feed-write-contract.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED WRITE WIRE CONTRACT
// -----------------------------------------------------------------------------
// O compositor pode evoluir para múltiplos tipos de anexo sem acoplar o payload
// da callable a um campo específico de foto. Nesta etapa somente `photo` é
// habilitado; vídeo e localização entrarão como variantes explícitas depois.
// -----------------------------------------------------------------------------

import type {
  CommunityFeedAudience,
  CommunityFeedPostCreateRequest,
} from './community-feed.model';

export interface CommunityFeedPhotoAttachmentPayload {
  readonly type: 'photo';
  readonly uploadPath: string;
}

export type CommunityFeedPostAttachmentPayload =
  CommunityFeedPhotoAttachmentPayload;

export interface CommunityFeedPostCreateWireRequest {
  readonly requestId: string;
  readonly communityId: string;
  readonly text: string;
  readonly audience: CommunityFeedAudience;
  readonly attachment: CommunityFeedPostAttachmentPayload | null;
  readonly replyToPostId: string | null;
}

export function buildCommunityFeedPostCreateWireRequest(
  request: CommunityFeedPostCreateRequest
): CommunityFeedPostCreateWireRequest {
  const imageUploadPath = request.imageUploadPath?.trim() || null;

  return {
    requestId: request.requestId.trim(),
    communityId: request.communityId.trim(),
    text: request.text.trim(),
    audience: request.audience,
    attachment: imageUploadPath
      ? {
          type: 'photo',
          uploadPath: imageUploadPath,
        }
      : null,
    replyToPostId: request.replyToPostId?.trim() || null,
  };
}
