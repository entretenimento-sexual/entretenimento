// functions/src/media/application/manage-photo-publication.handler.ts
// -----------------------------------------------------------------------------
// PHOTO PUBLICATION — PUBLISH / UNPUBLISH / COVER
// -----------------------------------------------------------------------------
// Segurança:
// - somente o dono publica/despublica/define capa;
// - cliente não grava projeção pública, score ou contadores;
// - métricas públicas são recalculadas no backend;
// - publicação comum ganha alcance imediato;
// - pré-moderação bloqueante só é ativada explicitamente por configuração.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';

type PhotoVisibility = 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
type CommentsPolicy = 'OFF' | 'FRIENDS' | 'SUBSCRIBERS' | 'EVERYONE';
type ModerationStatus = 'PENDING_REVIEW' | 'APPROVED';

type ScoreBreakdown = {
  rankingScore: number;
  qualityScore: number;
  engagementScore: number;
  safetyScore: number;
};

type PrivatePhotoDoc = {
  id?: string;
  url?: string;
  path?: string;
  fileName?: string;
  alt?: string;
  createdAt?: number;
  updatedAt?: number;
};

interface PublishPhotoRequest {
  ownerUid?: string;
  photoId?: string;
  visibility?: PhotoVisibility;
  isCover?: boolean;
  orderIndex?: number;
  commentsEnabled?: boolean;
  commentsPolicy?: CommentsPolicy;
  reactionsEnabled?: boolean;
}

interface PublishPhotoResponse {
  photoId: string;
  moderationStatus: ModerationStatus;
}

interface UnpublishPhotoRequest {
  ownerUid?: string;
  photoId?: string;
}

interface SetCoverPhotoRequest {
  ownerUid?: string;
  photoId?: string;
}

interface SetCoverPhotoResponse {
  photoId: string;
}

/**
 * A publicação imediata é o comportamento padrão do produto.
 *
 * Use MEDIA_REQUIRE_PREMODERATION=true somente em uma operação controlada na
 * qual toda nova foto realmente precise ficar retida antes de ganhar alcance.
 * Moderação posterior, denúncias e ocultação continuam sendo responsabilidades
 * do backend e não exigem transformar toda publicação comum em fila.
 */
const REQUIRE_PHOTO_PREMODERATION =
  process.env.MEDIA_REQUIRE_PREMODERATION === 'true';

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanVisibility(value: unknown): PhotoVisibility {
  const text = String(value ?? '').trim().toUpperCase();

  if (
    text === 'FRIENDS' ||
    text === 'SUBSCRIBERS' ||
    text === 'PREMIUM' ||
    text === 'PUBLIC'
  ) {
    return text;
  }

  return 'PUBLIC';
}

function cleanCommentsPolicy(value: unknown, commentsEnabled: boolean): CommentsPolicy {
  if (!commentsEnabled) {
    return 'OFF';
  }

  const text = String(value ?? '').trim().toUpperCase();

  if (text === 'FRIENDS' || text === 'SUBSCRIBERS' || text === 'EVERYONE') {
    return text;
  }

  return 'EVERYONE';
}

function normalizeOrderIndex(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

function normalizeCreatedAt(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Date.now();
  }

  return Math.floor(parsed);
}

function buildInitialScoreBreakdown(): ScoreBreakdown {
  return {
    rankingScore: 0,
    qualityScore: 0,
    engagementScore: 0,
    safetyScore: 100,
  };
}

function resolveModerationStatus(): ModerationStatus {
  return REQUIRE_PHOTO_PREMODERATION ? 'PENDING_REVIEW' : 'APPROVED';
}

function assertOwner(requesterUid: string | null, ownerUid: string): void {
  if (!requesterUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (requesterUid !== ownerUid) {
    throw new HttpsError(
      'permission-denied',
      'Você só pode publicar fotos do seu próprio perfil.'
    );
  }
}

export const publishPhoto = onCall<PublishPhotoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PublishPhotoResponse> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    assertOwner(requesterUid, ownerUid);

    const visibility = cleanVisibility(request.data?.visibility);
    const commentsEnabled = request.data?.commentsEnabled === true;
    const commentsPolicy = cleanCommentsPolicy(request.data?.commentsPolicy, commentsEnabled);
    const reactionsEnabled = request.data?.reactionsEnabled === true;
    const isCover = request.data?.isCover === true;
    const orderIndex = normalizeOrderIndex(request.data?.orderIndex);

    const privatePhotoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
    const publicationRef = db.doc(`users/${ownerUid}/photo_publications/${photoId}`);
    const publicPhotoRef = db.doc(`public_profiles/${ownerUid}/public_photos/${photoId}`);

    const privatePhotoSnap = await privatePhotoRef.get();

    if (!privatePhotoSnap.exists) {
      throw new HttpsError('not-found', 'Foto privada não encontrada.');
    }

    const privatePhoto = privatePhotoSnap.data() as PrivatePhotoDoc;

    if (!privatePhoto.url) {
      throw new HttpsError(
        'failed-precondition',
        'A foto não possui URL válida para publicação.'
      );
    }

    const now = Date.now();
    const moderationStatus = resolveModerationStatus();
    const scoreBreakdown = buildInitialScoreBreakdown();

    const batch = db.batch();

    if (isCover) {
      const publishedSnapshot = await db
        .collection(`users/${ownerUid}/photo_publications`)
        .where('isPublished', '==', true)
        .get();

      publishedSnapshot.docs.forEach((docSnap) => {
        batch.set(
          docSnap.ref,
          {
            isCover: false,
            updatedAt: now,
          },
          { merge: true }
        );

        batch.set(
          db.doc(`public_profiles/${ownerUid}/public_photos/${docSnap.id}`),
          {
            isCover: false,
            updatedAt: now,
          },
          { merge: true }
        );
      });
    }

    batch.set(
      publicationRef,
      {
        ownerUid,
        photoId,
        isPublished: true,
        visibility,
        isCover,
        orderIndex,
        commentsEnabled,
        commentsPolicy,
        commentsCount: 0,
        reactionsEnabled,
        reactionsCount: 0,
        moderationStatus,
        moderationReason: null,
        reportsCount: 0,
        score: 0,
        scoreBreakdown,
        publishedAt: now,
        updatedAt: now,
        lastModeratedAt: moderationStatus === 'APPROVED' ? now : null,
      },
      { merge: true }
    );

    batch.set(
      publicPhotoRef,
      {
        id: photoId,
        ownerUid,
        url: privatePhoto.url,
        alt: privatePhoto.alt ?? privatePhoto.fileName ?? 'Foto do perfil',
        createdAt: normalizeCreatedAt(privatePhoto.createdAt),
        publishedAt: now,
        updatedAt: now,
        visibility,
        isCover,
        orderIndex,
        commentsEnabled,
        commentsPolicy,
        commentsCount: 0,
        reactionsEnabled,
        reactionsCount: 0,
        moderationStatus,
        moderationReason: null,
        reportsCount: 0,
        score: 0,
        scoreBreakdown,
      },
      { merge: true }
    );

    await batch.commit();
    await refreshPublicProfileMediaMetrics(ownerUid);

    return {
      photoId,
      moderationStatus,
    };
  }
);

export const unpublishPhoto = onCall<UnpublishPhotoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ photoId: string }> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    assertOwner(requesterUid, ownerUid);

    const now = Date.now();
    const batch = db.batch();

    const publicationRef = db.doc(`users/${ownerUid}/photo_publications/${photoId}`);
    const publicPhotoRef = db.doc(`public_profiles/${ownerUid}/public_photos/${photoId}`);

    batch.set(
      publicationRef,
      {
        ownerUid,
        photoId,
        isPublished: false,
        visibility: 'PRIVATE',
        isCover: false,
        commentsEnabled: false,
        commentsPolicy: 'OFF',
        reactionsEnabled: false,
        moderationStatus: 'PRIVATE',
        updatedAt: now,
      },
      { merge: true }
    );

    batch.delete(publicPhotoRef);

    await batch.commit();
    await refreshPublicProfileMediaMetrics(ownerUid);

    return { photoId };
  }
);

export const setCoverPhoto = onCall<SetCoverPhotoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<SetCoverPhotoResponse> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    assertOwner(requesterUid, ownerUid);

    const targetPublicationRef = db.doc(`users/${ownerUid}/photo_publications/${photoId}`);
    const targetPublicationSnap = await targetPublicationRef.get();

    if (!targetPublicationSnap.exists) {
      throw new HttpsError('not-found', 'Publicação da foto não encontrada.');
    }

    const targetPublication = targetPublicationSnap.data();

    if (targetPublication?.isPublished !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Somente fotos publicadas podem ser definidas como capa.'
      );
    }

    const now = Date.now();
    const batch = db.batch();

    const publishedSnapshot = await db
      .collection(`users/${ownerUid}/photo_publications`)
      .where('isPublished', '==', true)
      .get();

    publishedSnapshot.docs.forEach((docSnap) => {
      const isTarget = docSnap.id === photoId;

      batch.set(
        docSnap.ref,
        {
          isCover: isTarget,
          updatedAt: now,
        },
        { merge: true }
      );

      batch.set(
        db.doc(`public_profiles/${ownerUid}/public_photos/${docSnap.id}`),
        {
          isCover: isTarget,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    await batch.commit();
    await refreshPublicProfileMediaMetrics(ownerUid);

    return { photoId };
  }
);
