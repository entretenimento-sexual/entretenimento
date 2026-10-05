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
// - publicação entra ativa por padrão e sem fila humana preventiva;
// - safetyScore pode permanecer desconhecido até existir sinal real de moderação;
// - denúncia posterior ou mecanismo em tempo real pode quarentenar e preservar evidência;
// - republicação usa precondition para não sobrescrever estado de revisão concorrente.

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertMediaAuthoringEligibility,
} from './media-authoring-eligibility.service';
import {
  buildUnassessedMediaContentSafetyAssessment,
} from './media-content-safety-assessment.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  resolveMediaPublicationVisibility,
  resolvePhotoCommentsPolicy,
  type AvailableMediaPublicationVisibility,
  type AvailablePhotoCommentsPolicy,
} from './media-publication-audience.policy';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  copyPrivatePhotoToPublishedAsset,
  deletePublishedPhotoAssetOrQueue,
} from './published-photo-asset.service';
import {
  buildUnassessedPhotoScoreBreakdown,
  defaultPhotoPublicationModerationStatus,
  isPhotoPublicationApproved,
} from './photo-publication-moderation.policy';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';

type PhotoVisibility = AvailableMediaPublicationVisibility;
type CommentsPolicy = AvailablePhotoCommentsPolicy;
type ModerationStatus = 'APPROVED';

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
  moderationStatus?: string;
};

interface PublishPhotoRequest {
  ownerUid?: string;
  photoId?: string;
  visibility?: PhotoVisibility;
  caption?: string | null;
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

interface SetCoverPhotoRequest {
  ownerUid?: string;
  photoId?: string;
}

interface SetCoverPhotoResponse {
  photoId: string;
}

const MAX_CAPTION_LENGTH = 800;

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function replaceAsciiControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    const isAsciiControl =
      codePoint !== undefined && (codePoint <= 31 || codePoint === 127);

    return isAsciiControl ? ' ' : character;
  }).join('');
}

function cleanCaption(value: unknown): string | null {
  const caption = replaceAsciiControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CAPTION_LENGTH);

  return caption || null;
}

function cleanVisibility(value: unknown): PhotoVisibility {
  const decision = resolveMediaPublicationVisibility(value);

  if (decision.status === 'UNAVAILABLE_ENTITLEMENT') {
    throw new HttpsError(
      'failed-precondition',
      'Audiências exclusivas para assinantes ainda não estão disponíveis.'
    );
  }

  if (decision.status === 'INVALID') {
    throw new HttpsError('invalid-argument', 'Visibilidade de foto inválida.');
  }

  return decision.value;
}

function cleanCommentsPolicy(
  value: unknown,
  commentsEnabled: boolean
): CommentsPolicy {
  const decision = resolvePhotoCommentsPolicy(value, commentsEnabled);

  if (decision.status === 'UNAVAILABLE_ENTITLEMENT') {
    throw new HttpsError(
      'failed-precondition',
      'Comentários exclusivos para assinantes ainda não estão disponíveis.'
    );
  }

  if (decision.status === 'INVALID') {
    throw new HttpsError(
      'invalid-argument',
      'Política de comentários da foto inválida.'
    );
  }

  return decision.value;
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

function resolveModerationStatus(): ModerationStatus {
  return defaultPhotoPublicationModerationStatus();
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

function isModerationLockedPublication(
  publication: PhotoPublicationDoc | null
): boolean {
  return publication?.isPublished === true &&
    !isPhotoPublicationApproved(publication.moderationStatus);
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

    await assertMediaAuthoringEligibility(ownerUid);

    const visibility = cleanVisibility(request.data?.visibility);
    const caption = cleanCaption(request.data?.caption);
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
    const previousPublication = previousPublicationSnap.exists
      ? (previousPublicationSnap.data() as PhotoPublicationDoc)
      : null;

    if (isModerationLockedPublication(previousPublication)) {
      throw new HttpsError(
        'failed-precondition',
        'Esta foto está temporariamente preservada durante uma análise de segurança.'
      );
    }

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
    const contentSafetyAssessment =
      buildUnassessedMediaContentSafetyAssessment(now);
    const scoreBreakdown = buildUnassessedPhotoScoreBreakdown();
    const batch = db.batch();

    const publicationPayload = {
      ownerUid,
      photoId,
      isPublished: true,
      visibility,
      caption,
      isCover: false,
      requestedIsCover: isCover,
      orderIndex,
      commentsEnabled,
      commentsPolicy,
      commentsCount: 0,
      reactionsEnabled,
      reactionsCount: 0,
      moderationStatus,
      moderationReason: null,
      contentSafetyAssessment,
      reportsCount: 0,
      openReportsCount: 0,
      confirmedReportsCount: 0,
      safetyScore: null,
      score: 0,
      scoreBreakdown,
      publishedAt: now,
      updatedAt: now,
      lastModeratedAt: null,
      moderatedBy: null,
      sourceStoragePath,
      publishedStoragePath,
      assetVersion: now,
    };

    if (previousPublicationSnap.exists && previousPublicationSnap.updateTime) {
      batch.update(
        publicationRef,
        publicationPayload,
        { lastUpdateTime: previousPublicationSnap.updateTime }
      );
    } else {
      batch.create(publicationRef, publicationPayload);
    }

    batch.set(
      publicPhotoRef,
      {
        id: photoId,
        ownerUid,
        mediaType: 'PHOTO',
        ageEligibilityAdultAccessAllowed: FieldValue.delete(),
        ageEligibilityVerifiedAdult: FieldValue.delete(),
        ageEligibilityAssurance: FieldValue.delete(),
        ageEligibilityValidUntil: FieldValue.delete(),
        assetAccess: 'SIGNED_URL',
        url: FieldValue.delete(),
        alt: privatePhoto.alt ?? privatePhoto.fileName ?? 'Foto do perfil',
        caption,
        createdAt: normalizeCreatedAt(privatePhoto.createdAt),
        publishedAt: now,
        updatedAt: now,
        visibility,
        isCover: false,
        orderIndex,
        commentsEnabled,
        commentsPolicy,
        commentsCount: 0,
        reactionsEnabled,
        reactionsCount: 0,
        moderationStatus,
        moderationReason: null,
        contentSafetyAssessment,
        reportsCount: 0,
        openReportsCount: 0,
        confirmedReportsCount: 0,
        safetyScore: null,
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

    const targetPublication = targetPublicationSnap.data() as PhotoPublicationDoc;

    if (targetPublication.isPublished !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Somente fotos publicadas podem ser definidas como capa.'
      );
    }

    if (!isPhotoPublicationApproved(targetPublication.moderationStatus)) {
      throw new HttpsError(
        'failed-precondition',
        'A foto precisa ser aprovada pela moderação antes de ser definida como capa.'
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
