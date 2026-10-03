import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertInteractionAccess } from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import {
  normalizeLegacyPhotoPreventiveReview,
} from './legacy-photo-preventive-review-migration.service';

interface NormalizeLegacyPhotoModerationRequest {
  ownerUid?: string;
  photoIds?: unknown[];
}

const MAX_PHOTO_IDS = 48;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

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

function normalizePhotoIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanId).filter(Boolean))].slice(0, MAX_PHOTO_IDS);
}

/**
 * Migração idempotente para fotos publicadas sob o fluxo antigo de
 * pré-moderação. Só libera preventive_media_review sintético de sistema;
 * denúncias reais e restrições posteriores permanecem intocadas.
 */
export const normalizeLegacyPhotoModeration = onCall<
  NormalizeLegacyPhotoModerationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoIds = normalizePhotoIds(request.data?.photoIds);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || requesterUid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'Você só pode normalizar fotos do seu próprio perfil.'
      );
    }

    if (photoIds.length === 0) {
      return { normalizedPhotoIds: [] as string[] };
    }

    await assertInteractionAccess(ownerUid);

    const normalizedPhotoIds: string[] = [];

    for (const photoId of photoIds) {
      try {
        const state = await normalizeLegacyPhotoPreventiveReview(
          ownerUid,
          photoId
        );
        if (state === 'normalized') normalizedPhotoIds.push(photoId);
      } catch (error) {
        logger.warn('[normalizeLegacyPhotoModeration] Item não normalizado.', {
          ownerUid,
          photoId,
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error ?? '').slice(0, 500),
        });
      }
    }

    if (normalizedPhotoIds.length > 0) {
      try {
        await refreshPublicProfileMediaMetrics(ownerUid);
      } catch (error) {
        logger.warn('[normalizeLegacyPhotoModeration] Métricas pendentes.', {
          ownerUid,
          normalizedCount: normalizedPhotoIds.length,
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error ?? '').slice(0, 500),
        });
      }
    }

    return { normalizedPhotoIds };
  }
);
