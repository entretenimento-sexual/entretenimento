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
// - publicação nasce PENDING_REVIEW e sem safetyScore presumido;
// - enquanto não avaliada, o ativo versionado fica retido e fora da distribuição;
// - denúncia posterior pode manter/agravar a quarentena e acionar evidência probatória;
// - republicação usa precondition para não sobrescrever estado de revisão concorrente.

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { getCanonicalAgeEligibilityForUid } from '../../compliance/age-eligibility.service';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, Timestamp } from '../../firebaseApp';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  copyPrivatePhotoToPublishedAsset,
  deletePublishedPhotoAssetOrQueue,
} from './published-photo-asset.service';
import {
  PHOTO_PREVENTIVE_REVIEW_MESSAGE,
  PHOTO_PREVENTIVE_REVIEW_REASON,
  buildPreventivePhotoReviewId,
  buildUnassessedPhotoScoreBreakdown,
  defaultPhotoPublicationModerationStatus,
  isPhotoPublicationApproved,
} from './photo-publication-moderation.policy';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';

type PhotoVisibility = 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
type CommentsPolicy = 'OFF' | 'FRIENDS' | 'SUBSCRIBERS' | 'EVERYONE';
type ModerationStatus = 'PENDING_REVIEW';

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

    const ageDecision = await getCanonicalAgeEligibilityForUid(ownerUid);
    if (!ageDecision.allowed) {
      throw new HttpsError(
        'failed-precondition',
        'Conclua a verificação de maioridade antes de publicar mídia.'
      );
    }
    const ageEligibilityValidUntil = Timestamp.fromMillis(
      ageDecision.expiresAtMs ?? 253402300799999
    );

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
    const scoreBreakdown = buildUnassessedPhotoScoreBreakdown();
    const moderationReportId = buildPreventivePhotoReviewId(
      ownerUid,
      photoId,
      now
    );
    const moderationReportRef = db
      .collection('moderation_reports')
      .doc(moderationReportId);
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
      moderationReason: PHOTO_PREVENTIVE_REVIEW_MESSAGE,
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
      preventiveReviewReportId: moderationReportId,
      reviewEvidenceRetention: 'PUBLISHED_ASSET_LOCKED',
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
        ageEligibilityVerifiedAdult: true,
        ageEligibilityValidUntil,
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
        moderationReason: PHOTO_PREVENTIVE_REVIEW_MESSAGE,
        reportsCount: 0,
        openReportsCount: 0,
        confirmedReportsCount: 0,
        safetyScore: null,
        score: 0,
        scoreBreakdown,
        preventiveReviewReportId: moderationReportId,
      },
      { merge: true }
    );

    batch.create(moderationReportRef, {
      reporterUid: 'system',
      targetType: 'photo',
      targetId: photoId,
      parentTargetId: null,
      targetOwnerUid: ownerUid,
      targetAuthorUid: ownerUid,
      reason: PHOTO_PREVENTIVE_REVIEW_REASON,
      details: PHOTO_PREVENTIVE_REVIEW_MESSAGE,
      route: null,
      status: 'open',
      moderationAction: null,
      contentQuarantined: true,
      evidencePreservationStatus: 'NOT_REQUIRED',
      evidenceRetentionStatus: 'PUBLISHED_ASSET_LOCKED',
      legalReviewStatus: null,
      source: 'system',
      reviewAssetVersion: now,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

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

/**
 * Implementação histórica mantida somente dentro deste módulo por
 * compatibilidade interna durante a migração. O export público `unpublishPhoto`
 * é redirecionado pelo media/index.ts para um handler fail-closed.
 */
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

    if (isModerationLockedPublication(publication)) {
      throw new HttpsError(
        'failed-precondition',
        'Esta foto está temporariamente preservada durante uma análise de segurança.'
      );
    }

    batch.set(
      publicationRef,
      {
        ownerUid,
        photoId,
        isPublished: false,
        visibility: 'PRIVATE',
        caption: FieldValue.delete(),
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
