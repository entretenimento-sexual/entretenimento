import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { deleteProfileVideoResources } from './delete-profile-video.handler';
import {
  shouldPreserveMediaEvidence,
  type MediaReportSafetyReason,
} from './media-report-safety';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import {
  queueModerationEvidencePreservation,
  releaseModerationEvidence,
} from './moderation-evidence-preservation.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
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
  contentQuarantined?: boolean;
  evidencePreservationStatus?: string;
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

interface VideoPublicationDocument {
  publishedStoragePath?: string;
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

interface TransactionResult {
  ownerUid: string;
  videoId: string;
  targetType: VideoReportTargetType;
  contentAvailableAtReview: boolean;
  reason: MediaReportSafetyReason | null;
  evidenceRequired: boolean;
  binaryEvidenceRequired: boolean;
  evidencePreservationStatus: string;
  publishedStoragePath: string | null;
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

function cleanReason(value: unknown): MediaReportSafetyReason | null {
  const normalized = String(value ?? '').trim().toLowerCase();

  return [
    'spam',
    'fake_profile',
    'harassment',
    'hate_or_abuse',
    'sexual_boundary',
    'illegal_content',
    'privacy',
    'minor_safety',
    'other',
  ].includes(normalized)
    ? normalized as MediaReportSafetyReason
    : null;
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

export const reviewVideoContentReport = onCall<
  ReviewVideoContentReportRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

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
        const reason = cleanReason(report.reason);

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
        const contentAvailableAtReview = videoSnap.exists;

        if (!videoSnap.exists && targetType !== 'video') {
          throw new HttpsError('not-found', 'Vídeo denunciado não encontrado.');
        }

        const video = videoSnap.exists
          ? videoSnap.data() as PublicVideoDocument
          : null;
        const publication = publicationSnap.exists
          ? publicationSnap.data() as VideoPublicationDocument
          : null;
        const event: VideoReportCounterEvent = decision === 'KEEP'
          ? 'KEEP'
          : 'REMOVE';
        const now = Date.now();

        if (decision === 'KEEP' && targetType === 'video') {
          if (video) {
            transaction.update(videoRef, {
              ...scorePatch(video, event),
              ...(report.contentQuarantined === true
                ? {
                  moderationStatus: 'APPROVED',
                  moderationReason: null,
                }
                : {}),
              updatedAt: now,
            });
          }

          if (report.contentQuarantined === true && publicationSnap.exists) {
            transaction.set(
              publicationRef,
              {
                isPublished: true,
                publishWhenReady: false,
                visibility: 'PUBLIC',
                moderationStatus: 'APPROVED',
                moderationReason: null,
                lastModeratedAt: FieldValue.serverTimestamp(),
                moderatedBy: adminUid,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        } else if (decision === 'KEEP') {
          if (!video) {
            throw new HttpsError('not-found', 'Vídeo denunciado não encontrado.');
          }

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
          if (video) {
            transaction.update(videoRef, {
              ...scorePatch(video, event),
              moderationStatus: 'HIDDEN',
              moderationReason: resolution,
              updatedAt: now,
            });
          }

          if (publicationSnap.exists) {
            transaction.set(
              publicationRef,
              {
                isPublished: true,
                publishWhenReady: false,
                visibility: 'PUBLIC',
                moderationStatus: 'FLAGGED',
                moderationReason: resolution,
                lastModeratedAt: FieldValue.serverTimestamp(),
                moderatedBy: adminUid,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        } else if (targetType === 'video_comment') {
          if (!video || !targetRef || !targetSnap?.exists) {
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
          if (!video || !targetRef || !targetSnap?.exists) {
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
        const evidencePreservationStatus = String(
          report.evidencePreservationStatus ?? 'NOT_REQUIRED'
        ).trim().toUpperCase();
        const binaryEvidenceRequired = targetType === 'video' &&
          !!reason &&
          shouldPreserveMediaEvidence(reason);
        const evidenceRequired = binaryEvidenceRequired ||
          evidencePreservationStatus === 'PENDING' ||
          evidencePreservationStatus === 'PRESERVED';

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
            contentQuarantined: report.contentQuarantined === true,
            contentAvailableAtReview,
            evidenceRequired,
            evidencePreservationStatus,
          },
          timestamp,
        });

        return {
          ownerUid,
          videoId,
          targetType,
          contentAvailableAtReview,
          reason,
          evidenceRequired,
          binaryEvidenceRequired,
          evidencePreservationStatus,
          publishedStoragePath:
            String(publication?.publishedStoragePath ?? '').trim() || null,
        };
      }
    );

    let cleanupPending = false;
    let evidenceReleasePending = false;
    let evidencePreservationPending = false;

    if (decision === 'KEEP' && result.evidenceRequired) {
      try {
        await releaseModerationEvidence(reportId, 'REPORT_REJECTED');
      } catch (error) {
        evidenceReleasePending = true;
        logger.error('[reviewVideoContentReport] Liberação de evidência pendente.', {
          reportId,
          ownerUid: result.ownerUid,
          videoId: result.videoId,
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error ?? '').slice(0, 500),
        });
      }
    }

    if (decision === 'REMOVE' && result.targetType === 'video') {
      let evidenceReady = !result.binaryEvidenceRequired ||
        result.evidencePreservationStatus === 'PRESERVED';

      if (
        result.binaryEvidenceRequired &&
        !evidenceReady &&
        result.reason
      ) {
        const preservation = await queueModerationEvidencePreservation({
          reportId,
          mediaType: 'VIDEO',
          ownerUid: result.ownerUid,
          mediaId: result.videoId,
          reason: result.reason,
          sourceStoragePath: result.publishedStoragePath,
        });
        evidenceReady = preservation.preserved;
        evidencePreservationPending = !preservation.preserved;
      }

      if (evidenceReady) {
        try {
          const deletion = await deleteProfileVideoResources(
            result.ownerUid,
            result.videoId,
            { allowQuarantined: true }
          );
          cleanupPending = deletion.cleanupPending;
        } catch (error) {
          cleanupPending = true;
          logger.error('[reviewVideoContentReport] Exclusão total pendente.', {
            ownerUid: result.ownerUid,
            videoId: result.videoId,
            error: error instanceof Error
              ? error.message.slice(0, 500)
              : String(error ?? '').slice(0, 500),
          });
        }
      } else {
        cleanupPending = true;
      }
    }

    return {
      reportId,
      decision,
      targetType: result.targetType,
      contentAvailableAtReview: result.contentAvailableAtReview,
      cleanupPending,
      evidencePreservationPending,
      evidenceReleasePending,
    };
  }
);
