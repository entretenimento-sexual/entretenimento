import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  evaluatePublicVideoAccountEligibility,
  isActiveUserBlock,
  type PublicVideoAccountDenialReason,
} from './public-video-audience-access.policy';
import { hasPublicVideoPlaybackPlan } from './public-video-playback-plan.policy';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';
import {
  normalizeOwnedPublishedVideoPath,
  normalizeOwnedPublishedVideoPosterPath,
} from './video-storage-path';

interface PublicVideoAccessRequestItem {
  ownerUid?: string;
  videoId?: string;
}

interface PublicVideoAccessRequest {
  items?: PublicVideoAccessRequestItem[];
}

interface PublicVideoAccessResponseItem {
  ownerUid: string;
  videoId: string;
  url: string;
  posterUrl: string | null;
  expiresAt: number;
}

interface PublicVideoAccessResponse {
  items: PublicVideoAccessResponseItem[];
}

interface PublicVideoAccessResolution {
  item: PublicVideoAccessResponseItem | null;
  technicalFailure: boolean;
}

const MAX_ITEMS_PER_REQUEST = 16;
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

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

function buildRequestKey(ownerUid: string, videoId: string): string {
  return `${ownerUid}:${videoId}`;
}

function viewerEligibilityError(
  reason: PublicVideoAccountDenialReason | null
): HttpsError {
  switch (reason) {
  case 'profile_missing':
    return new HttpsError('not-found', 'Seu perfil não foi localizado.');

  case 'account_restricted':
    return new HttpsError(
      'permission-denied',
      'Sua conta não está disponível para visualizar vídeos.'
    );

  case 'email_unverified':
    return new HttpsError(
      'failed-precondition',
      'Confirme seu e-mail antes de visualizar vídeos.'
    );

  case 'adult_access_required':
    return new HttpsError(
      'failed-precondition',
      'A confirmação de acesso adulto precisa ser concluída.'
    );

  case 'terms_required':
    return new HttpsError(
      'failed-precondition',
      'Aceite os termos atuais antes de visualizar vídeos.'
    );

  case 'profile_incomplete':
  default:
    return new HttpsError(
      'failed-precondition',
      'Complete seu perfil antes de visualizar vídeos.'
    );
  }
}

async function canViewerAccessOwner(
  viewerUid: string,
  viewerUser: Readonly<Record<string, unknown>>,
  ownerUid: string
): Promise<boolean> {
  if (ownerUid === viewerUid) {
    return evaluatePublicVideoAccountEligibility(
      viewerUser,
      ownerUid,
      { requireVerifiedEmail: false }
    ).allowed;
  }

  const ownerRef = db.doc(`users/${ownerUid}`);
  const viewerBlockRef = db.doc(`users/${viewerUid}/blocks/${ownerUid}`);
  const ownerBlockRef = db.doc(`users/${ownerUid}/blocks/${viewerUid}`);
  const [ownerSnap, viewerBlockSnap, ownerBlockSnap] = await Promise.all([
    ownerRef.get(),
    viewerBlockRef.get(),
    ownerBlockRef.get(),
  ]);

  const ownerDecision = evaluatePublicVideoAccountEligibility(
    ownerSnap.exists ? ownerSnap.data() : null,
    ownerUid,
    { requireVerifiedEmail: false }
  );

  if (!ownerDecision.allowed) {
    return false;
  }

  return !isActiveUserBlock(
    viewerBlockSnap.exists ? viewerBlockSnap.data() : null
  ) && !isActiveUserBlock(
    ownerBlockSnap.exists ? ownerBlockSnap.data() : null
  );
}

async function resolveAccessItem(
  ownerUid: string,
  videoId: string,
  expiresAt: number,
  viewerUser: Readonly<Record<string, unknown>>
): Promise<PublicVideoAccessResponseItem | null> {
  const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
  const publicVideoRef = db.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const [publicProfileSnap, publicVideoSnap, publicationSnap] =
    await Promise.all([
      publicProfileRef.get(),
      publicVideoRef.get(),
      publicationRef.get(),
    ]);

  if (
    !publicProfileSnap.exists ||
    !publicVideoSnap.exists ||
    !publicationSnap.exists
  ) {
    return null;
  }

  const publicVideo = publicVideoSnap.data();
  const publication = publicationSnap.data();

  if (
    publicVideo?.visibility !== 'PUBLIC' ||
    publicVideo?.moderationStatus !== 'APPROVED' ||
    publication?.isPublished !== true
  ) {
    return null;
  }

  const minimumPlaybackPlan =
    publication?.minimumPlaybackPlan ?? publicVideo?.minimumPlaybackPlan;

  if (!hasPublicVideoPlaybackPlan(viewerUser, minimumPlaybackPlan)) {
    return null;
  }

  const videoStoragePath = normalizeOwnedPublishedVideoPath(
    ownerUid,
    videoId,
    publication?.publishedStoragePath
  );

  if (!videoStoragePath) {
    return null;
  }

  const videoFile = storage.bucket().file(videoStoragePath);
  const [videoExists] = await videoFile.exists();

  if (!videoExists) {
    throw new Error(
      'O ativo publicado do vídeo não foi encontrado no Storage.'
    );
  }

  const posterStoragePath = normalizeOwnedPublishedVideoPosterPath(
    ownerUid,
    videoId,
    publication?.publishedPosterStoragePath
  );
  let posterUrl: string | null = null;

  if (posterStoragePath) {
    const posterFile = storage.bucket().file(posterStoragePath);
    const [posterExists] = await posterFile.exists();

    if (posterExists) {
      posterUrl = await createTemporaryStorageReadUrl(
        posterStoragePath,
        expiresAt
      );
    }
  }

  return {
    ownerUid,
    videoId,
    url: await createTemporaryStorageReadUrl(videoStoragePath, expiresAt),
    posterUrl,
    expiresAt,
  };
}

export const getPublicVideoAccessUrls = onCall<PublicVideoAccessRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PublicVideoAccessResponse> => {
    const viewerUid = cleanId(request.auth?.uid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const viewerSnap = await db.doc(`users/${viewerUid}`).get();
    const viewerUser = viewerSnap.exists
      ? viewerSnap.data()
      : null;
    const viewerDecision = evaluatePublicVideoAccountEligibility(
      viewerUser,
      viewerUid,
      {
        authenticatedEmailVerified:
          request.auth?.token?.email_verified === true,
      }
    );

    if (!viewerDecision.allowed) {
      throw viewerEligibilityError(viewerDecision.reason);
    }

    const rawItems = Array.isArray(request.data?.items)
      ? request.data.items
      : [];

    if (!rawItems.length || rawItems.length > MAX_ITEMS_PER_REQUEST) {
      throw new HttpsError(
        'invalid-argument',
        `Informe entre 1 e ${MAX_ITEMS_PER_REQUEST} vídeos.`
      );
    }

    const uniqueItems = new Map<
      string,
      { ownerUid: string; videoId: string }
    >();

    for (const item of rawItems) {
      const ownerUid = cleanId(item?.ownerUid);
      const videoId = cleanId(item?.videoId);

      if (!ownerUid || !videoId) {
        continue;
      }

      uniqueItems.set(buildRequestKey(ownerUid, videoId), {
        ownerUid,
        videoId,
      });
    }

    if (!uniqueItems.size) {
      throw new HttpsError(
        'invalid-argument',
        'Nenhum vídeo válido informado.'
      );
    }

    const normalizedViewerUser = viewerUser as Readonly<Record<string, unknown>>;
    const ownerAccessCache = new Map<string, Promise<boolean>>();
    const ownerAccess = (ownerUid: string): Promise<boolean> => {
      const cached = ownerAccessCache.get(ownerUid);

      if (cached) {
        return cached;
      }

      const pending = canViewerAccessOwner(
        viewerUid,
        normalizedViewerUser,
        ownerUid
      );
      ownerAccessCache.set(ownerUid, pending);
      return pending;
    };

    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    const resolutions = await Promise.all(
      [...uniqueItems.values()].map(
        async ({ ownerUid, videoId }): Promise<PublicVideoAccessResolution> => {
          try {
            if (!await ownerAccess(ownerUid)) {
              return { item: null, technicalFailure: false };
            }

            return {
              item: await resolveAccessItem(
                ownerUid,
                videoId,
                expiresAt,
                normalizedViewerUser
              ),
              technicalFailure: false,
            };
          } catch (error) {
            logger.warn('[getPublicVideoAccessUrls] Falha ao gerar acesso.', {
              viewerUid,
              ownerUid,
              videoId,
              error: error instanceof Error
                ? error.message
                : String(error ?? ''),
            });

            return {
              item: null,
              technicalFailure: true,
            };
          }
        }
      )
    );
    const items = resolutions.flatMap((resolution) =>
      resolution.item ? [resolution.item] : []
    );
    const technicalFailureCount = resolutions.filter(
      (resolution) => resolution.technicalFailure
    ).length;

    if (!items.length && technicalFailureCount > 0) {
      throw new HttpsError(
        'internal',
        'Não foi possível liberar os vídeos neste momento.'
      );
    }

    return { items };
  }
);
