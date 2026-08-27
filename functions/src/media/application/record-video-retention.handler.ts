import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { buildMediaEngagementScore } from './media-engagement-score';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import { normalizeVideoAudienceScore } from './video-audience-score';
import { buildVideoRetentionAggregate } from './video-retention-score';
import {
  hashVideoRetentionToken,
  normalizeVideoRetentionToken,
} from './video-retention-token';
import {
  type VideoViewPlaybackEvidenceInput,
  normalizeVideoViewPlaybackEvidence,
} from './video-view-qualification';

interface RecordVideoRetentionRequest {
  ownerUid?: string;
  videoId?: string;
  retentionToken?: string;
  evidence?: VideoViewPlaybackEvidenceInput;
}

interface RecordVideoRetentionResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
  improved: boolean;
  retentionScore: number;
  retentionAveragePercent: number;
  completionRate: number;
}

const RETENTION_WALL_CLOCK_TOLERANCE_MS = 5_000;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= 128 && !normalized.includes('/')
    ? normalized
    : '';
}

function safeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
}

function assertPublicApprovedVideo(
  exists: boolean,
  video: FirebaseFirestore.DocumentData | undefined
): void {
  if (!exists) {
    throw new HttpsError('not-found', 'Vídeo público não encontrado.');
  }

  if (
    video?.visibility !== 'PUBLIC' ||
    video?.moderationStatus !== 'APPROVED'
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Vídeo indisponível para atualização de retenção.'
    );
  }
}

export const recordVideoRetention = onCall<RecordVideoRetentionRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RecordVideoRetentionResponse> => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const retentionToken = normalizeVideoRetentionToken(
      request.data?.retentionToken
    );

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId || !retentionToken) {
      throw new HttpsError('invalid-argument', 'Progresso de vídeo inválido.');
    }

    if (viewerUid === ownerUid) {
      throw new HttpsError(
        'failed-precondition',
        'O próprio autor não participa da retenção pública.'
      );
    }

    await assertPublicMediaConsumptionAccess(viewerUid);

    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const viewerRef = publicVideoRef.collection('views').doc(viewerUid);
    const now = Date.now();
    const expectedTokenHash = hashVideoRetentionToken(retentionToken);

    return db.runTransaction(async (transaction) => {
      const [videoSnap, viewerSnap] = await Promise.all([
        transaction.get(publicVideoRef),
        transaction.get(viewerRef),
      ]);

      assertPublicApprovedVideo(videoSnap.exists, videoSnap.data());

      if (!viewerSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'A visualização ainda não foi qualificada para retenção.'
        );
      }

      const video = videoSnap.data() ?? {};
      const viewer = viewerSnap.data() ?? {};
      const tokenHash = String(viewer.retentionTokenHash ?? '').trim();
      const tokenExpiresAt = safeNumber(viewer.retentionTokenExpiresAt);
      const playbackStartedAt = safeNumber(viewer.retentionPlaybackStartedAt);

      if (
        viewer.ownerUid !== ownerUid ||
        viewer.videoId !== videoId ||
        viewer.viewerUid !== viewerUid ||
        !tokenHash ||
        tokenHash !== expectedTokenHash ||
        tokenExpiresAt <= now ||
        !playbackStartedAt
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A autorização de retenção é inválida ou expirou.'
        );
      }

      const evidence = normalizeVideoViewPlaybackEvidence({
        evidence: request.data?.evidence,
        serverDurationMs: safeNumber(video.durationMs),
        now,
      });

      if (!evidence) {
        throw new HttpsError(
          'failed-precondition',
          'O progresso informado não é válido para retenção.'
        );
      }

      const elapsedWallClockMs = Math.max(0, now - playbackStartedAt);

      if (
        evidence.playbackMs >
        elapsedWallClockMs + RETENTION_WALL_CLOCK_TOLERANCE_MS
      ) {
        throw new HttpsError(
          'failed-precondition',
          'O progresso informado excede o tempo possível de reprodução.'
        );
      }

      const nextRetention = buildVideoRetentionAggregate({
        currentContributorsCount: video.retentionContributorsCount,
        currentBasisPointsTotal: video.retentionBasisPointsTotal,
        currentCompletionViewersCount: video.completionViewersCount,
        previousViewerBasisPoints: viewer.bestQualifiedPlaybackBasisPoints,
        playbackMs: evidence.playbackMs,
        durationMs: evidence.durationMs,
      });

      if (!nextRetention.improved) {
        return {
          ok: true,
          ownerUid,
          videoId,
          improved: false,
          retentionScore: safeNumber(video.retentionScore),
          retentionAveragePercent: safeNumber(video.retentionAveragePercent),
          completionRate: safeNumber(video.completionRate),
        };
      }

      const audienceScore = normalizeVideoAudienceScore(video.viewScore);
      const nextRanking = buildMediaEngagementScore({
        reactionsCount: safeNumber(video.reactionsCount ?? video.likesCount),
        commentsCount: safeNumber(video.commentsCount),
        ratingsCount: safeNumber(video.ratingsCount),
        ratingAverage: safeNumber(video.ratingAverage),
        currentBreakdown: {
          ...safeRecord(video.scoreBreakdown),
          audienceScore,
          retentionScore: nextRetention.retentionScore,
        },
      });

      transaction.set(
        viewerRef,
        {
          lastViewedAt: now,
          lastQualifiedPlaybackMs: evidence.playbackMs,
          lastQualifiedDurationMs: evidence.durationMs,
          bestQualifiedPlaybackBasisPoints: nextRetention.viewerBasisPoints,
          lastRetentionSessionId: evidence.sessionId,
          retentionUpdatedAt: now,
        },
        { merge: true }
      );
      transaction.set(
        publicVideoRef,
        {
          audienceScore,
          retentionContributorsCount: nextRetention.contributorsCount,
          retentionBasisPointsTotal: nextRetention.basisPointsTotal,
          retentionAveragePercent: nextRetention.averagePercent,
          completionViewersCount: nextRetention.completionViewersCount,
          completionRate: nextRetention.completionRate,
          retentionScore: nextRetention.retentionScore,
          engagementScore: nextRanking.engagementScore,
          score: nextRanking.score,
          scoreBreakdown: nextRanking.scoreBreakdown,
          retentionUpdatedAt: now,
        },
        { merge: true }
      );

      return {
        ok: true,
        ownerUid,
        videoId,
        improved: true,
        retentionScore: nextRetention.retentionScore,
        retentionAveragePercent: nextRetention.averagePercent,
        completionRate: nextRetention.completionRate,
      };
    });
  }
);
