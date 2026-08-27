// src/app/community/feed/community-composer-attachment.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY COMPOSER ATTACHMENT
// -----------------------------------------------------------------------------
// Modelo canônico do anexo selecionado no composer. Nesta etapa somente imagem
// é habilitada; novos tipos devem entrar como variantes explícitas, sem criar
// estados paralelos no componente do Mural.
// -----------------------------------------------------------------------------

import {
  MEDIA_IMAGE_ACCEPT,
  validateImageMediaFile,
} from 'src/app/core/services/media/media-format.policy';
import { IMAGE_MAX_BYTES } from 'src/app/core/services/media/media-format.generated';

export interface CommunityComposerImageAttachment {
  readonly kind: 'image';
  readonly file: File;
  readonly previewUrl: string | null;
}

export type CommunityComposerAttachment = CommunityComposerImageAttachment;

export const COMMUNITY_COMPOSER_IMAGE_ACCEPT = MEDIA_IMAGE_ACCEPT;
export const MAX_COMMUNITY_COMPOSER_IMAGE_BYTES = IMAGE_MAX_BYTES;

export type CommunityComposerImageValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly userMessage: string };

export function validateCommunityComposerImage(
  file: File
): CommunityComposerImageValidation {
  const validation = validateImageMediaFile(file, 'default');

  return validation.valid
    ? { valid: true }
    : {
        valid: false,
        userMessage: validation.userMessage ?? 'A foto selecionada não é válida.',
      };
}
