import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertInteractionAccess } from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import {
  isLegacyPendingVideoModeration,
  isRestrictedVideoModerationStatus,
} from './video-publication-moderation.policy';

interface NormalizeLegacyVideoModerationRequest {
  ownerUid?: string;
  videoIds?: unknown[];
}

interface VideoPublicationDocument {
  ownerUid?: unknown;
  videoId?: unknown;
  isPublished?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
}

interface PublicVideoDocument {
  ownerUid?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
}

const MAX_VIDEO_IDS = 24;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
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

function normalizeVideoIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(cleanId).filter(Boolean))].slice(0, MAX_VIDEO_IDS);
}

async function normalizeLegacyVideo(
  ownerUid: string,
  videoId: string
): Promise<boolean> {
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const publicVideoRef = db.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );

  return db.runTransaction(async (transaction) => {
    const [publicationSnap, publicVideoSnap] = await Promise.all([
      transaction.get(publicationRef),
      transaction.get(publicVideoRef),
    ]);

    if (!publicationSnap.exists || !publicVideoSnap.exists) {
      return false;
    }

    const publication = publicationSnap.data() as VideoPublicationDocument;
    const publicVideo = publicVideoSnap.data() as PublicVideoDocument;
    const publicationOwnerUid = cleanId(publication.ownerUid ?? ownerUid);
    const publicationVideoId = cleanId(publication.videoId ?? videoId);
    const publicOwnerUid = cleanId(publicVideo.ownerUid ?? ownerUid);

    if (
      publicationOwnerUid !== ownerUid ||
      publicationVideoId !== videoId ||
      publicOwnerUid !== ownerUid ||
      publication.isPublished !== true ||
      String(publication.visibility ?? '').trim().toUpperCase() !== 'PUBLIC' ||
      String(publicVideo.visibility ?? '').trim().toUpperCase() !== 'PUBLIC'
    ) {
      return false;
    }

    if (
      isRestrictedVideoModerationStatus(publication.moderationStatus) ||
      isRestrictedVideoModerationStatus(publicVideo.moderationStatus)
    ) {
      return false;
    }

    if (
      !isLegacyPendingVideoModeration(publication.moderationStatus) &&
      !isLegacyPendingVideoModeration(publicVideo.moderationStatus)
    ) {
      return false;
    }

    const timestamp = FieldValue.serverTimestamp();

    transaction.set(
      publicationRef,
      {
        moderationStatus: 'APPROVED',
        moderationReason: null,
        moderatedBy: FieldValue.delete(),
        lastModeratedAt: FieldValue.delete(),
        updatedAt: timestamp,
      },
      { merge: true }
    );
    transaction.set(
      publicVideoRef,
      {
        moderationStatus: 'APPROVED',
        moderationReason: null,
        updatedAt: timestamp,
      },
      { merge: true }
    );

    return true;
  });
}

/**
 * Migração idempotente para vídeos publicados sob a regra antiga de
 * pré-moderação. Não toca em FLAGGED/HIDDEN/REJECTED: restrições originadas de
 * denúncia só podem ser removidas pelo fluxo administrativo de denúncias.
 */
export const normalizeLegacyVideoModeration = onCall<
  NormalizeLegacyVideoModerationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoIds = normalizeVideoIds(request.data?.videoIds);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || requesterUid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'Você só pode normalizar vídeos do seu próprio perfil.'
      );
    }

    if (videoIds.length === 0) {
      return { normalizedVideoIds: [] as string[] };
    }

    await assertInteractionAccess(ownerUid);

    const normalizedVideoIds: string[] = [];

    for (const videoId of videoIds) {
      try {
        if (await normalizeLegacyVideo(ownerUid, videoId)) {
          normalizedVideoIds.push(videoId);
        }
      } catch (error) {
        logger.warn('[normalizeLegacyVideoModeration] Item não normalizado.', {
          ownerUid,
          videoId,
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error ?? '').slice(0, 500),
        });
      }
    }

    if (normalizedVideoIds.length > 0) {
      try {
        await refreshPublicProfileMediaMetrics(ownerUid);
      } catch (error) {
        logger.warn('[normalizeLegacyVideoModeration] Métricas pendentes.', {
          ownerUid,
          normalizedCount: normalizedVideoIds.length,
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error ?? '').slice(0, 500),
        });
      }
    }

    return { normalizedVideoIds };
  }
);
