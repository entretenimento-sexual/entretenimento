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
  type AvailableMediaPublicationVisibility,
} from './media-publication-audience.policy';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import {
  copyPrivateVideoToPublishedAsset,
  deletePublishedVideoAssetOrQueue,
} from './published-video-asset.service';
import {
  buildUnassessedVideoScoreBreakdown,
  defaultVideoPublicationModerationStatus,
} from './video-publication-moderation.policy';
import {
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';
import { resolveVideoPublicationPrivateSource } from './video-publication-source-fence.policy';
import {
  assertPublishableVideo,
  assertPublicationCanStart,
  assertSourceWasNotRejected,
  normalizeOptionalPositiveInteger,
  commitCopiedVideoPublicationIfCurrent,
  type OwnerVideoDoc,
  type VideoPublicationDoc,
} from './video-publication-commit.firestore';

type VideoVisibility = AvailableMediaPublicationVisibility;
type ModerationStatus = 'APPROVED';
type PublishedVideoAssets = Awaited<
  ReturnType<typeof copyPrivateVideoToPublishedAsset>
>;

interface PublishVideoRequest {
  ownerUid?: string;
  videoId?: string;
  visibility?: VideoVisibility;
  orderIndex?: number;
}

interface PublishVideoResponse {
  videoId: string;
  moderationStatus: ModerationStatus;
}

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

function cleanVisibility(value: unknown): VideoVisibility {
  const decision = resolveMediaPublicationVisibility(value);

  if (decision.status === 'UNAVAILABLE_ENTITLEMENT') {
    throw new HttpsError(
      'failed-precondition',
      'Audiências exclusivas para assinantes ainda não estão disponíveis.'
    );
  }

  if (decision.status === 'INVALID') {
    throw new HttpsError('invalid-argument', 'Visibilidade de vídeo inválida.');
  }

  return decision.value;
}

function normalizeOrderIndex(value: unknown): number {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.min(10_000, Math.trunc(numberValue)));
}

function normalizeCreatedAt(value: unknown): number {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : Date.now();
}

function assertOwner(requesterUid: string | null, ownerUid: string): void {
  if (!requesterUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (requesterUid !== ownerUid) {
    throw new HttpsError(
      'permission-denied',
      'Você só pode publicar vídeos do seu próprio perfil.'
    );
  }
}

async function cleanupReplacedPublishedAssets(
  ownerUid: string,
  videoId: string,
  previousPublication: VideoPublicationDoc | null,
  currentVideoStoragePath: string,
  currentPosterStoragePath: string | null
): Promise<void> {
  const previousVideoStoragePath = previousPublication?.publishedStoragePath;
  const previousPosterStoragePath =
    previousPublication?.publishedPosterStoragePath;
  const cleanupTasks: Promise<boolean>[] = [];

  if (
    previousVideoStoragePath &&
    previousVideoStoragePath !== currentVideoStoragePath
  ) {
    cleanupTasks.push(
      deletePublishedVideoAssetOrQueue({
        ownerUid,
        videoId,
        storagePath: previousVideoStoragePath,
        assetKind: 'video',
        reason: 'replace-published-video-version',
      })
    );
  }

  if (
    previousPosterStoragePath &&
    previousPosterStoragePath !== currentPosterStoragePath
  ) {
    cleanupTasks.push(
      deletePublishedVideoAssetOrQueue({
        ownerUid,
        videoId,
        storagePath: previousPosterStoragePath,
        assetKind: 'poster',
        reason: 'replace-published-video-poster',
      })
    );
  }

  await Promise.all(cleanupTasks);
}

async function rollbackPublishedAssets(
  ownerUid: string,
  videoId: string,
  publishedAssets: PublishedVideoAssets
): Promise<void> {
  await Promise.all([
    deletePublishedVideoAssetOrQueue({
      ownerUid,
      videoId,
      storagePath: publishedAssets.videoStoragePath,
      assetKind: 'video',
      reason: 'publish-video-firestore-rollback',
    }),
    deletePublishedVideoAssetOrQueue({
      ownerUid,
      videoId,
      storagePath: publishedAssets.posterStoragePath,
      assetKind: 'poster',
      reason: 'publish-video-poster-firestore-rollback',
    }),
  ]);
}

export const publishVideo = onCall<PublishVideoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PublishVideoResponse> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    assertOwner(requesterUid, ownerUid);

    await assertMediaAuthoringEligibility(ownerUid);

    const visibility = cleanVisibility(request.data?.visibility);
    const orderIndex = normalizeOrderIndex(request.data?.orderIndex);
    const ownerVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const [ownerVideoSnap, previousPublicationSnap] = await Promise.all([
      ownerVideoRef.get(),
      publicationRef.get(),
    ]);

    if (!ownerVideoSnap.exists) {
      throw new HttpsError('not-found', 'Vídeo não encontrado.');
    }

    const ownerVideo = ownerVideoSnap.data() as OwnerVideoDoc;
    const previousPublication = previousPublicationSnap.exists
      ? (previousPublicationSnap.data() as VideoPublicationDoc)
      : null;
    assertPublishableVideo(ownerVideo);
    assertPublicationCanStart(previousPublication);

    const sourceVideoStoragePath = resolveVideoPublicationPrivateSource(
      ownerUid, videoId, ownerVideo
    );

    if (!sourceVideoStoragePath) {
      throw new HttpsError(
        'failed-precondition',
        'O vídeo não possui um arquivo-fonte protegido válido para publicação.'
      );
    }

    assertSourceWasNotRejected(previousPublication, sourceVideoStoragePath);

    const sourcePosterStoragePath =
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        ownerVideo.thumbnailPath
      ) ??
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        ownerVideo.thumbnailUrl
      );

    let publishedAssets: PublishedVideoAssets;

    try {
      publishedAssets = await copyPrivateVideoToPublishedAsset({
        ownerUid,
        videoId,
        sourceVideoStoragePath,
        sourcePosterStoragePath,
      });
    } catch (error) {
      logger.error('[publishVideo] Falha ao preparar ativo publicado.', {
        ownerUid,
        videoId,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível preparar o vídeo para publicação.'
      );
    }

    const now = Date.now();
    const moderationStatus = defaultVideoPublicationModerationStatus();
    const contentSafetyAssessment =
      buildUnassessedMediaContentSafetyAssessment(now);
    const scoreBreakdown = buildUnassessedVideoScoreBreakdown();
    const durationMs = normalizeOptionalPositiveInteger(
      ownerVideo.durationMs
    );
    const publicationPatch = {
      ownerUid,
      videoId,
      isPublished: true,
      publishWhenReady: false,
      visibility,
      orderIndex,
      moderationStatus,
      moderationReason: null,
      contentSafetyAssessment,
      reportsCount: 0,
      openReportsCount: 0,
      confirmedReportsCount: 0,
      safetyScore: null,
      score: 0,
      scoreBreakdown,
      preventiveReviewReportId: FieldValue.delete(),
      reviewEvidenceRetention: FieldValue.delete(),
      viewsCount: 0,
      uniqueViewersCount: 0,
      publishedAt: now,
      updatedAt: now,
      lastModeratedAt: FieldValue.delete(),
      sourceStoragePath: sourceVideoStoragePath,
      rejectedSourceStoragePath: FieldValue.delete(),
      moderatedBy: FieldValue.delete(),
      publishedStoragePath: publishedAssets.videoStoragePath,
      publishedPosterStoragePath:
        publishedAssets.posterStoragePath ?? FieldValue.delete(),
      assetVersion: now,
    };
    const publicVideoPatch = {
      id: videoId,
      ownerUid,
      mediaType: 'VIDEO',
      ageEligibilityAdultAccessAllowed: FieldValue.delete(),
      ageEligibilityVerifiedAdult: FieldValue.delete(),
      ageEligibilityAssurance: FieldValue.delete(),
      ageEligibilityValidUntil: FieldValue.delete(),
      assetAccess: 'SIGNED_URL',
      posterAccess: publishedAssets.posterStoragePath
        ? 'SIGNED_URL'
        : 'NONE',
      url: FieldValue.delete(),
      posterUrl: FieldValue.delete(),
      title: String(
        ownerVideo.fileName ?? 'Vídeo do perfil'
      ).slice(0, 160),
      alt: 'Vídeo publicado no perfil',
      mimeType: publishedAssets.videoContentType,
      sizeBytes: publishedAssets.sizeBytes,
      durationMs,
      createdAt: normalizeCreatedAt(ownerVideo.createdAt),
      publishedAt: now,
      updatedAt: now,
      assetVersion: now,
      visibility,
      orderIndex,
      moderationStatus,
      moderationReason: null,
      contentSafetyAssessment,
      reportsCount: 0,
      openReportsCount: 0,
      confirmedReportsCount: 0,
      safetyScore: null,
      score: 0,
      scoreBreakdown,
      preventiveReviewReportId: FieldValue.delete(),
    };

    let committedPreviousPublication: VideoPublicationDoc | null = null;
    try {
      committedPreviousPublication = await commitCopiedVideoPublicationIfCurrent(
        db, {
          ownerUid,
          videoId,
          sourceVideoStoragePath,
          sourceProcessedStoragePath: publishedAssets.sourceProcessedStoragePath,
          publicationPatch,
          publicVideoPatch,
        }
      );
    } catch (error) {
      await rollbackPublishedAssets(ownerUid, videoId, publishedAssets);
      throw error;
    }

    await cleanupReplacedPublishedAssets(
      ownerUid,
      videoId,
      committedPreviousPublication,
      publishedAssets.videoStoragePath,
      publishedAssets.posterStoragePath
    );
    await refreshPublicProfileMediaMetrics(ownerUid);

    return {
      videoId,
      moderationStatus,
    };
  }
);