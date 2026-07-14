import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import { buildVideoReportSafetyState } from './video-report-safety';

export type VideoReportTargetType =
  | 'video'
  | 'video_comment'
  | 'video_rating';

export type VideoReportReason =
  | 'spam'
  | 'fake_profile'
  | 'harassment'
  | 'hate_or_abuse'
  | 'sexual_boundary'
  | 'illegal_content'
  | 'privacy'
  | 'minor_safety'
  | 'other';

interface ReportVideoContentRequest {
  targetType?: VideoReportTargetType;
  ownerUid?: string;
  videoId?: string;
  targetId?: string | null;
  reason?: VideoReportReason;
  details?: string | null;
  route?: string | null;
}

interface PublicVideoDocument {
  ownerUid?: string;
  visibility?: string;
  moderationStatus?: string;
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  ratingsCount?: number;
  ratingAverage?: number;
  reportsCount?: number;
  openReportsCount?: number;
  confirmedReportsCount?: number;
  scoreBreakdown?: Partial<MediaScoreBreakdown>;
}

interface VideoCommentDocument {
  authorUid?: string;
  status?: string;
  reportsCount?: number;
  openReportsCount?: number;
}

interface VideoRatingDocument {
  uid?: string;
  rating?: number;
  reportsCount?: number;
  openReportsCount?: number;
}

const ALLOWED_REASONS = new Set<VideoReportReason>([
  'spam',
  'fake_profile',
  'harassment',
  'hate_or_abuse',
  'sexual_boundary',
  'illegal_content',
  'privacy',
  'minor_safety',
  'other',
]);

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

function cleanReason(value: unknown): VideoReportReason | null {
  const normalized = String(value ?? '').trim().toLowerCase() as VideoReportReason;
  return ALLOWED_REASONS.has(normalized) ? normalized : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  return normalized || null;
}

function buildReportId(
  reporterUid: string,
  targetType: VideoReportTargetType,
  ownerUid: string,
  videoId: string,
  targetId: string
): string {
  return createHash('sha256')
    .update([reporterUid, targetType, ownerUid, videoId, targetId].join('|'))
    .digest('hex')
    .slice(0, 48);
}

function assertPublicApprovedVideo(video: PublicVideoDocument): void {
  if (video.visibility !== 'PUBLIC' || video.moderationStatus !== 'APPROVED') {
    throw new HttpsError(
      'failed-precondition',
      'Este conteúdo não está disponível para denúncia pública.'
    );
  }
}

export const reportVideoContent = onCall<ReportVideoContentRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const reporterUid = cleanId(request.auth?.uid);
    const targetType = cleanTargetType(request.data?.targetType);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const requestedTargetId = cleanId(request.data?.targetId);
    const reason = cleanReason(request.data?.reason);
    const details = cleanText(request.data?.details, 1200);
    const route = cleanText(request.data?.route, 300);

    if (!reporterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!targetType || !ownerUid || !videoId || !reason) {
      throw new HttpsError('invalid-argument', 'Denúncia de vídeo inválida.');
    }

    const targetId = targetType === 'video' ? videoId : requestedTargetId;

    if (!targetId) {
      throw new HttpsError('invalid-argument', 'Alvo da denúncia inválido.');
    }

    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const targetRef = targetType === 'video_comment'
      ? publicVideoRef.collection('comments').doc(targetId)
      : targetType === 'video_rating'
        ? publicVideoRef.collection('ratings').doc(targetId)
        : null;
    const reportId = buildReportId(
      reporterUid,
      targetType,
      ownerUid,
      videoId,
      targetId
    );
    const reportRef = db.collection('moderation_reports').doc(reportId);

    await db.runTransaction(async (transaction) => {
      const readRefs = targetRef
        ? [publicVideoRef, targetRef, reportRef]
        : [publicVideoRef, reportRef];
      const snapshots = await Promise.all(
        readRefs.map((reference) => transaction.get(reference))
      );
      const videoSnap = snapshots[0];
      const targetSnap = targetRef ? snapshots[1] : null;
      const reportSnap = targetRef ? snapshots[2] : snapshots[1];

      if (!videoSnap.exists) {
        throw new HttpsError('not-found', 'Vídeo público não encontrado.');
      }

      if (reportSnap.exists) {
        throw new HttpsError(
          'already-exists',
          'Você já denunciou este conteúdo.'
        );
      }

      const video = videoSnap.data() as PublicVideoDocument;

      if (video.ownerUid !== ownerUid) {
        throw new HttpsError('failed-precondition', 'Vídeo inconsistente.');
      }

      assertPublicApprovedVideo(video);

      let targetAuthorUid: string | null = ownerUid;
      let targetReportsCount = 0;
      let targetOpenReportsCount = 0;

      if (targetType === 'video') {
        if (reporterUid === ownerUid) {
          throw new HttpsError(
            'failed-precondition',
            'Você não pode denunciar o próprio vídeo.'
          );
        }
      } else if (targetType === 'video_comment') {
        if (!targetSnap?.exists || !targetRef) {
          throw new HttpsError('not-found', 'Comentário não encontrado.');
        }

        const comment = targetSnap.data() as VideoCommentDocument;
        targetAuthorUid = cleanId(comment.authorUid);

        if (comment.status !== 'VISIBLE' || !targetAuthorUid) {
          throw new HttpsError(
            'failed-precondition',
            'Comentário indisponível para denúncia.'
          );
        }

        if (reporterUid === targetAuthorUid) {
          throw new HttpsError(
            'failed-precondition',
            'Você não pode denunciar o próprio comentário.'
          );
        }

        targetReportsCount = normalizeMediaCount(comment.reportsCount);
        targetOpenReportsCount = normalizeMediaCount(comment.openReportsCount);
      } else {
        if (reporterUid !== ownerUid) {
          throw new HttpsError(
            'permission-denied',
            'Somente o autor do vídeo pode denunciar uma avaliação específica.'
          );
        }

        if (!targetSnap?.exists || !targetRef) {
          throw new HttpsError('not-found', 'Avaliação não encontrada.');
        }

        const rating = targetSnap.data() as VideoRatingDocument;
        targetAuthorUid = cleanId(rating.uid) || targetId;
        targetReportsCount = normalizeMediaCount(rating.reportsCount);
        targetOpenReportsCount = normalizeMediaCount(rating.openReportsCount);
      }

      const safetyState = buildVideoReportSafetyState(video, 'OPEN');
      const nextScore = buildMediaEngagementScore({
        reactionsCount: normalizeMediaCount(
          video.reactionsCount ?? video.likesCount
        ),
        commentsCount: normalizeMediaCount(video.commentsCount),
        ratingsCount: normalizeMediaCount(video.ratingsCount),
        ratingAverage: Number(video.ratingAverage ?? 0),
        currentBreakdown: {
          ...video.scoreBreakdown,
          safetyScore: safetyState.safetyScore,
        },
      });
      const timestamp = FieldValue.serverTimestamp();

      transaction.create(reportRef, {
        reporterUid,
        targetType,
        targetId,
        parentTargetId: videoId,
        targetOwnerUid: ownerUid,
        targetAuthorUid,
        reason,
        details,
        route,
        status: 'open',
        moderationAction: null,
        source: 'web',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.update(publicVideoRef, {
        reportsCount: safetyState.reportsCount,
        openReportsCount: safetyState.openReportsCount,
        confirmedReportsCount: safetyState.confirmedReportsCount,
        safetyScore: safetyState.safetyScore,
        score: nextScore.score,
        scoreBreakdown: nextScore.scoreBreakdown,
        updatedAt: Date.now(),
      });

      if (targetRef) {
        transaction.update(targetRef, {
          reportsCount: targetReportsCount + 1,
          openReportsCount: targetOpenReportsCount + 1,
          updatedAt: Date.now(),
        });
      }
    });

    return { reportId };
  }
);
