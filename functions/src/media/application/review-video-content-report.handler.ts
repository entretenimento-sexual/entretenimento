import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import { deletePublishedVideoAssetOrQueue } from './published-video-asset.service';
import {
  buildVideoRatingAggregateAfterRemoval,
  normalizeVideoRating,
} from './video-rating-aggregate';
import {
  buildVideoReportSafetyState,
  type VideoReportCounterEvent,
} from './video-report-safety';
import type { VideoReportTargetType } from './report-video-content.handler';

export type VideoContentReportDecision = 'KEEP' | 'REMOVE';

interface ReviewVideoContentReportRequest {
  reportId?: string;
  decision?: VideoContentReportDecision;
  resolution?: string | null;
}

interface ModerationReportDocument {
  reporterUid?: string;
  targetType?: string;
  targetId?: string;
  parentTargetId?: string;
  targetOwnerUid?: string;
  targetAuthorUid?: string;
  reason?: string;
  status?: string;
  moderationAction?: string | null;
}

interface PublicVideoDocument {
  ownerUid?: string;
  visibility?: string;
  moderationStatus?: string;
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  ratingsCount?: number;
  ratingTotal?: number;
  ratingAverage?: number;
  reportsCount?: number;
  openReportsCount?: number;
  confirmedReportsCount?: number;
  scoreBreakdown?: Partial<MediaScoreBreakdown>;
}

interface VideoCommentDocument {
  authorUid?: string;
  content?: string;
  status?: string;
  parentCommentId?: string | null;
  reportsCount?: number;
  openReportsCount?: number;
  confirmedReportsCount?: number;
}

interface VideoRatingDocument {
  uid?: string;
  rating?: number;
  reportsCount?: number;
  openReportsCount?: number;
  confirmedReportsCount?: number;
}

interface VideoPublicationDocument {
  sourceStoragePath?: string;
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
}

interface TransactionResult {
  ownerUid: string;
  videoId: string;
  targetType: VideoReportTargetType;
  publication: VideoPublicationDocument | null;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanTargetType(value: unknown): VideoReportTargetType | null {
  const normalized = String(value ?? '').trim().toLowerCase();

  return normalized === 'video' ||
    normalized === 'video_comment' ||
    normalized === 'video_rating'
    ? normalized
    : null;
}

function cleanDecision(value: unknown): VideoContentReportDecision | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'KEEP' || normalized === 'REMOVE'
    ? normalized
    : null;
}

function cleanResolution(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
}

function assertAdmin(requestAuth: unknown): string {
  const authData = requestAuth as {
    uid?: unknown;
    token?: unknown;
  } | null | undefined;
  const adminUid = cleanId(authData?.uid);
  const token = typeof authData?.token === 'object' && authData.token !== null
    ? authData.token as Record<string, unknown>
    : {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const allowed = token['admin'] === true ||
    token['role'] === 'admin' ||
    roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem revisar denúncias de vídeo.'
    );
  }

  return adminUid;
}

function targetCounterPatch(
  target: {
    reportsCount?: unknown;
    openReportsCount?: unknown;
    confirmedReportsCount?: unknown;
  },
  event: VideoReportCounterEvent
): Record<string, number> {
  const openReportsCount = Math.max(
    0,
    normalizeMediaCount(target.openReportsCount) - 1
  );
  const confirmedReportsCount = event === 'REMOVE'
    ? normalizeMediaCount(target.confirmedReportsCount) + 1
    : normalizeMediaCount(target.confirmedReportsCount);

  return {
    reportsCount: normalizeMediaCount(target.reportsCount),
    openReportsCount,
    confirmedReportsCount,
  };
}

function scorePatch(
  video: PublicVideoDocument,
  event: VideoReportCounterEvent,
  commentsCount = normalizeMediaCount(video.commentsCount),
  ratingsCount = normalizeMediaCount(video.ratingsCount),
  ratingAverage = Number(video.ratingAverage ?? 0)
): Record<string, unknown> {
  const safetyState = buildVideoReportSafetyState(video, event);
  const nextScore = buildMediaEngagementScore({
    reactionsCount: normalizeMediaCount(
      video.reactionsCount ?? video.likesCount
    ),
    commentsCount,
    ratingsCount,
    ratingAverage,
    currentBreakdown: {
      ...video.scoreBreakdown,
      safetyScore: safetyState.safetyScore,
    },
  });

  return {
    ...safetyState,
    engagementScore: nextScore.engagementScore,
    score: nextScore.score,
    scoreBreakdown: nextScore.scoreBreakdown,
  };
}

async function refreshMetricsBestEffort(ownerUid: string): Promise<void> {
  try {
    await refreshPublicProfileMediaMetrics(ownerUid);
  } catch (error) {
    logger.warn('[reviewVideoContentReport] Falha ao atualizar métricas.', {
      ownerUid,
      error: error instanceof Error ? error.message : String(error ?? ''),
    });
  }
}

export const reviewVideoContentReport = onCall<
  ReviewVideoContentReportRequest
>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const adminUid = assertAdmin(request.auth);
    const reportId = cleanId(request.data?.reportId);
    const decision = cleanDecision(request.data?.decision);
    const resolution = cleanResolution(request.data?.resolution);

    if (!reportId || !decision) {
      throw new HttpsError('invalid-argument', 'Decisão de denúncia inválida.');
    }

    if (resolution.length < 8) {
      throw new HttpsError(
        'invalid-argument',
        'Registre uma justificativa objetiva para a decisão.'
      );
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const adminLogRef = db.collection('admin_logs').doc();

    const result = await db.runTransaction<TransactionResult>(
      async (transaction) => {
        const reportSnap = await transaction.get(reportRef);

        if (!reportSnap.exists) {
          throw new HttpsError('not-found', 'Denúncia não encontrada.');
        }

        const report = reportSnap.data() as ModerationReportDocument;
        const targetType = cleanTargetType(report.targetType);
        const ownerUid = cleanId(report.targetOwnerUid);
        const videoId = cleanId(report.parentTargetId);
        const targetId = cleanId(report.targetId);
        const status = String(report.status ?? '').trim().toLowerCase();

        if (!targetType || !ownerUid || !videoId || !targetId) {
          throw new HttpsError(
            'failed-precondition',
            'A denúncia não possui referências válidas.'
          );
        }

        if (status !== 'open' && status !== 'reviewing') {
          throw new HttpsError(
            'failed-precondition',
            'Esta denúncia já foi encerrada.'
          );
        }

        const videoRef = db.doc(
          `public_profiles/${ownerUid}/public_videos/${videoId}`
        );
        const publicationRef = db.doc(
          `users/${ownerUid}/video_publications/${videoId}`
        );
        const targetRef = targetType === 'video_comment'
          ? videoRef.collection('comments').doc(targetId)
          : targetType === 'video_rating'
            ? videoRef.collection('ratings').doc(targetId)
            : null;
        const readRefs = targetRef
          ? [videoRef, publicationRef, targetRef]
          : [videoRef, publicationRef];
        const snapshots = await Promise.all(
          readRefs.map((reference) => transaction.get(reference))
        );
        const videoSnap = snapshots[0];
        const publicationSnap = snapshots[1];
        const targetSnap = targetRef ? snapshots[2] : null;

        if (!videoSnap.exists) {
          throw new HttpsError('not-found', 'Vídeo denunciado não encontrado.');
        }

        const video = videoSnap.data() as PublicVideoDocument;
        const event: VideoReportCounterEvent = decision === 'KEEP'
          ? 'KEEP'
          : 'REMOVE';
        const now = Date.now();
        let publication: VideoPublicationDocument | null = publicationSnap.exists
          ? publicationSnap.data() as VideoPublicationDocument
          : null;

        if (decision === 'KEEP') {
          transaction.update(videoRef, {
            ...scorePatch(video, event),
            updatedAt: now,
          });

          if (targetRef && targetSnap?.exists) {
            transaction.update(targetRef, {
              ...targetCounterPatch(
                targetSnap.data() as VideoCommentDocument,
                event
              ),
              updatedAt: now,
            });
          }
        } else if (targetType === 'video') {
          if (!publicationSnap.exists) {
            throw new HttpsError(
              'not-found',
              'Publicação denunciada não encontrada.'
            );
          }

          transaction.set(
            publicationRef,
            {
              isPublished: false,
              visibility: 'PRIVATE',
              moderationStatus: 'REJECTED',
              moderationReason: resolution,
              rejectedSourceStoragePath: publication?.sourceStoragePath ?? null,
              lastModeratedAt: FieldValue.serverTimestamp(),
              moderatedBy: adminUid,
              publishedStoragePath: FieldValue.delete(),
              publishedPosterStoragePath: FieldValue.delete(),
              assetVersion: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          transaction.delete(videoRef);
        } else if (targetType === 'video_comment') {
          if (!targetRef || !targetSnap?.exists) {
            throw new HttpsError('not-found', 'Comentário denunciado não encontrado.');
          }

          const comment = targetSnap.data() as VideoCommentDocument;
          const affectsCount = !comment.parentCommentId &&
            comment.status === 'VISIBLE';
          const commentsCount = Math.max(
            0,
            normalizeMediaCount(video.commentsCount) - (affectsCount ? 1 : 0)
          );

          transaction.update(targetRef, {
            ...targetCounterPatch(comment, event),
            status: 'DELETED',
            content: '',
            deletedAt: now,
            updatedAt: now,
          });
          transaction.update(videoRef, {
            ...scorePatch(video, event, commentsCount),
            commentsCount,
            updatedAt: now,
          });
        } else {
          if (!targetRef || !targetSnap?.exists) {
            throw new HttpsError('not-found', 'Avaliação denunciada não encontrada.');
          }

          const rating = targetSnap.data() as VideoRatingDocument;
          const ratingValue = normalizeVideoRating(rating.rating);

          if (ratingValue === null) {
            throw new HttpsError(
              'failed-precondition',
              'A avaliação denunciada é inválida.'
            );
          }

          const aggregate = buildVideoRatingAggregateAfterRemoval(
            video,
            ratingValue
          );

          transaction.delete(targetRef);
          transaction.update(videoRef, {
            ...aggregate,
            ...scorePatch(
              video,
              event,
              normalizeMediaCount(video.commentsCount),
              aggregate.ratingsCount,
              aggregate.ratingAverage
            ),
            updatedAt: now,
          });
        }

        const timestamp = FieldValue.serverTimestamp();
        const reportStatus = decision === 'KEEP' ? 'rejected' : 'resolved';

        transaction.update(reportRef, {
          status: reportStatus,
          moderationAction: decision,
          resolution,
          reviewedBy: adminUid,
          reviewedAt: timestamp,
          updatedAt: timestamp,
        });
        transaction.set(adminLogRef, {
          adminUid,
          action: 'moderationReportReview',
          targetUserUid: ownerUid,
          details: {
            reportId,
            previousStatus: status,
            nextStatus: reportStatus,
            reason: report.reason ?? null,
            targetType,
            moderationAction: decision,
            resolution,
          },
          timestamp,
        });

        return { ownerUid, videoId, targetType, publication };
      }
    );

    let cleanupPending = false;

    if (decision === 'REMOVE' && result.targetType === 'video') {
      const videoPath = result.publication?.publishedStoragePath;
      const posterPath = result.publication?.publishedPosterStoragePath;
      const cleanupResults = await Promise.all([
        deletePublishedVideoAssetOrQueue({
          ownerUid: result.ownerUid,
          videoId: result.videoId,
          storagePath: videoPath,
          assetKind: 'video',
          reason: 'reported-video-removed',
        }),
        deletePublishedVideoAssetOrQueue({
          ownerUid: result.ownerUid,
          videoId: result.videoId,
          storagePath: posterPath,
          assetKind: 'poster',
          reason: 'reported-video-poster-removed',
        }),
      ]);
      cleanupPending = cleanupResults.some((deleted) => !deleted);

      await db.recursiveDelete(
        db.doc(
          `public_profiles/${result.ownerUid}/public_videos/${result.videoId}`
        )
      );
      await refreshMetricsBestEffort(result.ownerUid);
    }

    return {
      reportId,
      decision,
      targetType: result.targetType,
      cleanupPending,
    };
  }
);
