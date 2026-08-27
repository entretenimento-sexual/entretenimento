import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  buildMediaReportSafetyState,
  shouldPreserveMediaEvidence,
  shouldQuarantineMediaAfterReport,
  type MediaReportSafetyReason,
} from './media-report-safety';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import {
  queueModerationEvidencePreservation,
} from './moderation-evidence-preservation.service';
import {
  preserveModerationTextEvidenceInTransaction,
} from './moderation-text-evidence.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';

export type VideoReportTargetType =
  | 'video'
  | 'video_comment'
  | 'video_rating';

export type VideoReportReason = MediaReportSafetyReason;

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

interface VideoPublicationDocument {
  publishedStoragePath?: string;
}

interface VideoCommentDocument {
  authorUid?: string;
  content?: string;
  status?: string;
  parentCommentId?: string | null;
  createdAt?: number;
  reportsCount?: number;
  openReportsCount?: number;
}

interface VideoRatingDocument {
  uid?: string;
  rating?: number;
  reportsCount?: number;
  openReportsCount?: number;
}

interface ReportVideoTransactionResult {
  publishedStoragePath: string | null;
  quarantine: boolean;
  evidenceRequired: boolean;
  binaryEvidenceRequired: boolean;
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
const REPORT_BURST_WINDOW_MS = 60 * 1000;
const REPORT_BURST_MAX = 12;
const REPORT_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const REPORT_SUSTAINED_MAX = 48;
const QUARANTINE_REASON =
  'Conteúdo temporariamente indisponível durante análise de segurança.';

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
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

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

    await consumeBackendRateLimitQuota({
      action: 'reportVideoContent',
      subject: reporterUid,
      cost: 1,
      config: {
        burstWindowMs: REPORT_BURST_WINDOW_MS,
        burstMax: REPORT_BURST_MAX,
        sustainedWindowMs: REPORT_SUSTAINED_WINDOW_MS,
        sustainedMax: REPORT_SUSTAINED_MAX,
      },
      message: 'Muitas denúncias foram enviadas em pouco tempo.',
    });
    await assertInteractionAccess(reporterUid);
    await assertPublicMediaConsumptionAccess(reporterUid);

    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
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

    const result = await db.runTransaction<ReportVideoTransactionResult>(
      async (transaction) => {
        const readRefs = targetRef
          ? [publicVideoRef, targetRef, reportRef]
          : [publicVideoRef, publicationRef, reportRef];
        const snapshots = await Promise.all(
          readRefs.map((reference) => transaction.get(reference))
        );
        const videoSnap = snapshots[0];
        const publicationSnap = targetRef ? null : snapshots[1];
        const targetSnap = targetRef ? snapshots[1] : null;
        const reportSnap = snapshots[2];

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
        let reportedComment: VideoCommentDocument | null = null;

        if (targetType === 'video') {
          if (reporterUid === ownerUid) {
            throw new HttpsError(
              'failed-precondition',
              'Você não pode denunciar o próprio vídeo.'
            );
          }

          if (!publicationSnap?.exists) {
            throw new HttpsError(
              'failed-precondition',
              'A publicação deste vídeo não está disponível para moderação.'
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

          reportedComment = comment;
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

        const safetyState = buildMediaReportSafetyState(video, 'OPEN');
        const quarantine = targetType === 'video' &&
          shouldQuarantineMediaAfterReport(reason, safetyState.openReportsCount);
        const binaryEvidenceRequired = targetType === 'video' &&
          shouldPreserveMediaEvidence(reason);
        const textEvidenceRequired = targetType === 'video_comment';
        const evidenceRequired = binaryEvidenceRequired || textEvidenceRequired;
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
          contentQuarantined: quarantine,
          evidencePreservationStatus: binaryEvidenceRequired
            ? 'PENDING'
            : textEvidenceRequired
              ? 'PRESERVED'
              : 'NOT_REQUIRED',
          source: 'web',
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        if (reportedComment && targetAuthorUid) {
          preserveModerationTextEvidenceInTransaction(transaction, {
            reportId,
            ownerUid,
            parentMediaId: videoId,
            targetId,
            targetAuthorUid,
            reason,
            content: String(reportedComment.content ?? ''),
            contentCreatedAt: reportedComment.createdAt,
            parentTargetId: reportedComment.parentCommentId ?? null,
          });
        }

        transaction.update(publicVideoRef, {
          reportsCount: safetyState.reportsCount,
          openReportsCount: safetyState.openReportsCount,
          confirmedReportsCount: safetyState.confirmedReportsCount,
          safetyScore: safetyState.safetyScore,
          score: nextScore.score,
          scoreBreakdown: nextScore.scoreBreakdown,
          ...(quarantine
            ? {
              moderationStatus: 'HIDDEN',
              moderationReason: QUARANTINE_REASON,
            }
            : {}),
          updatedAt: Date.now(),
        });

        if (quarantine && publicationSnap?.exists) {
          transaction.set(
            publicationRef,
            {
              isPublished: true,
              publishWhenReady: false,
              visibility: 'PUBLIC',
              moderationStatus: 'FLAGGED',
              moderationReason: QUARANTINE_REASON,
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        }

        if (targetRef) {
          transaction.update(targetRef, {
            reportsCount: targetReportsCount + 1,
            openReportsCount: targetOpenReportsCount + 1,
            updatedAt: Date.now(),
          });
        }

        const publication = publicationSnap?.exists
          ? publicationSnap.data() as VideoPublicationDocument
          : null;

        return {
          publishedStoragePath:
            String(publication?.publishedStoragePath ?? '').trim() || null,
          quarantine,
          evidenceRequired,
          binaryEvidenceRequired,
        };
      }
    );

    if (result.binaryEvidenceRequired) {
      await queueModerationEvidencePreservation({
        reportId,
        mediaType: 'VIDEO',
        ownerUid,
        mediaId: videoId,
        reason,
        sourceStoragePath: result.publishedStoragePath,
      });
    }

    return {
      reportId,
      contentQuarantined: result.quarantine,
      evidencePreservationRequired: result.evidenceRequired,
    };
  }
);
