// src/app/community/feed/community-composer-attachment.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY COMPOSER ATTACHMENT
// -----------------------------------------------------------------------------
// Modelo canônico do anexo selecionado no composer. Foto e localização
// aproximada são variantes explícitas do mesmo estado, sem criar fluxos
// paralelos no componente do Mural. Coordenadas precisas nunca são persistidas.
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

export interface CommunityComposerLocationAttachment {
  readonly kind: 'location';
  readonly latitude: number;
  readonly longitude: number;
  readonly precision: 'approximate';
}

export type CommunityComposerAttachment =
  | CommunityComposerImageAttachment
  | CommunityComposerLocationAttachment;

export const COMMUNITY_COMPOSER_LOCATION_DECIMALS = 2;

export function createCommunityComposerLocationAttachment(
  latitude: unknown,
  longitude: unknown
): CommunityComposerLocationAttachment | null {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);

  if (
    !Number.isFinite(parsedLatitude)
    || !Number.isFinite(parsedLongitude)
    || parsedLatitude < -90
    || parsedLatitude > 90
    || parsedLongitude < -180
    || parsedLongitude > 180
  ) {
    return null;
  }

  return {
    kind: 'location',
    latitude: Number(parsedLatitude.toFixed(COMMUNITY_COMPOSER_LOCATION_DECIMALS)),
    longitude: Number(parsedLongitude.toFixed(COMMUNITY_COMPOSER_LOCATION_DECIMALS)),
    precision: 'approximate',
  };
}

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
