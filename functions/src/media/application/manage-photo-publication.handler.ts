// functions/src/media/application/manage-photo-publication.handler.ts
// -----------------------------------------------------------------------------
// PHOTO PUBLICATION — PUBLISH / UNPUBLISH / COVER
// -----------------------------------------------------------------------------
// Segurança:
// - somente o dono publica/despublica/define capa;
// - o arquivo privado nunca é usado diretamente na projeção pública;
// - a publicação cria uma cópia física versionada em namespace isolado;
// - a projeção pública não armazena URL permanente nem storagePath;
// - o acesso temporário é emitido por backend após nova validação;
// - cliente não grava projeção pública, score ou contadores;
// - métricas públicas são recalculadas no backend;
// - publicação comum ganha alcance imediato;
// - pré-moderação bloqueante só é ativada explicitamente por configuração.

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  copyPrivatePhotoToPublishedAsset,
  deletePublishedPhotoAssetOrQueue,
} from './published-photo-asset.service';
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

type PhotoPublicationDoc = {
  isPublished?: boolean;
  publishedStoragePath?: string;
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

function cleanCommentsPolicy(
  value: unknown,
  commentsEnabled: boolean
): CommentsPolicy {
  if (!commentsEnabled) {
    return 'OFF';
  }

  const text = String(value ?? '').trim().toUpperCase();

  if (
    text === 'FRIENDS' ||
    text === 'SUBSCRIBERS' ||
    text === 'EVERYONE'
  ) {
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

function resolvePrivatePhotoStoragePath(
  ownerUid: string,
  privatePhoto: PrivatePhotoDoc
): string | null {
  return (
    extractOwnedPrivatePhotoPath(ownerUid, privatePhoto.path) ??
    extractOwnedPrivatePhotoPath(ownerUid, privatePhoto.url)
  );
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
    const commentsPolicy = cleanCommentsPolicy(
      request.data?.commentsPolicy,
      commentsEnabled
    );
    const reactionsEnabled = request.data?.reactionsEnabled === true;
    const isCover = request.data?.isCover === true;
    const orderIndex = normalizeOrderIndex(request.data?.orderIndex);

    const privatePhotoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );

    const [privatePhotoSnap, previousPublicationSnap] = await Promise.all([
      privatePhotoRef.get(),
      publicationRef.get(),
    ]);

    if (!privatePhotoSnap.exists) {
      throw new HttpsError('not-found', 'Foto privada não encontrada.');
    }

    const privatePhoto = privatePhotoSnap.data() as PrivatePhotoDoc;
    const sourceStoragePath = resolvePrivatePhotoStoragePath(
      ownerUid,
      privatePhoto
    );

    if (!sourceStoragePath) {
      throw new HttpsError(
        'failed-precondition',
        'A foto não possui um arquivo privado válido para publicação.'
      );
    }

    let publishedStoragePath = '';

    try {
      publishedStoragePath = await copyPrivatePhotoToPublishedAsset({
        ownerUid,
        photoId,
        sourceStoragePath,
      });
    } catch (error) {
      logger.error('[publishPhoto] Falha ao preparar ativo publicado.', {
        ownerUid,
        photoId,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível preparar a foto para publicação.'
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
        sourceStoragePath,
        publishedStoragePath,
        assetVersion: now,
      },
      { merge: true }
    );

    batch.set(
      publicPhotoRef,
      {
        id: photoId,
        ownerUid,
        mediaType: 'PHOTO',
        assetAccess: 'SIGNED_URL',
        url: FieldValue.delete(),
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

    try {
      await batch.commit();
    } catch (error) {
      await deletePublishedPhotoAssetOrQueue({
        ownerUid,
        photoId,
        storagePath: publishedStoragePath,
        reason: 'publish-firestore-rollback',
      });

      throw error;
    }

    const previousPublication = previousPublicationSnap.exists
      ? (previousPublicationSnap.data() as PhotoPublicationDoc)
      : null;
    const previousPublishedStoragePath =
      previousPublication?.publishedStoragePath ?? null;

    if (
      previousPublishedStoragePath &&
      previousPublishedStoragePath !== publishedStoragePath
    ) {
      await deletePublishedPhotoAssetOrQueue({
        ownerUid,
        photoId,
        storagePath: previousPublishedStoragePath,
        reason: 'replace-published-photo-version',
      });
    }

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
    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const publicationSnap = await publicationRef.get();
    const publication = publicationSnap.exists
      ? (publicationSnap.data() as PhotoPublicationDoc)
      : null;

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
        publishedStoragePath: FieldValue.delete(),
        sourceStoragePath: FieldValue.delete(),
        assetVersion: FieldValue.delete(),
      },
      { merge: true }
    );

    batch.delete(publicPhotoRef);
    await batch.commit();

    await deletePublishedPhotoAssetOrQueue({
      ownerUid,
      photoId,
      storagePath: publication?.publishedStoragePath,
      reason: 'unpublish-photo',
    });
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

    const targetPublicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
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
