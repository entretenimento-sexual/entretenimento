import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  MEDIA_RANKING_VERSION,
  buildMediaEngagementScore,
  normalizeMediaCount,
  normalizeMediaRatingAverage,
  normalizeMediaScore,
  normalizeMediaTimestamp,
  normalizeMediaTotal,
  type MediaScoreBreakdown,
} from './media-engagement-score';

const RANKING_REFRESH_LIMIT_PER_QUERY = 240;

interface PublicVideoRankingDocument extends FirebaseFirestore.DocumentData {
  visibility?: unknown;
  moderationStatus?: unknown;
  reactionsCount?: unknown;
  likesCount?: unknown;
  commentsCount?: unknown;
  ratingsCount?: unknown;
  ratingAverage?: unknown;
  viewsCount?: unknown;
  uniqueViewersCount?: unknown;
  qualifiedViewsCount?: unknown;
  totalQualifiedPlaybackMs?: unknown;
  totalQualifiedDurationMs?: unknown;
  publishedAt?: unknown;
  score?: unknown;
  viewScore?: unknown;
  retentionScore?: unknown;
  freshnessScore?: unknown;
  engagementScore?: unknown;
  rankingVersion?: unknown;
  scoreBreakdown?: Partial<MediaScoreBreakdown> | null;
}

interface VideoRankingUpdate {
  score: number;
  engagementScore: number;
  viewScore: number;
  retentionScore: number;
  freshnessScore: number;
  scoreBreakdown: MediaScoreBreakdown;
  rankingVersion: number;
  rankingUpdatedAt: number;
}

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function isRankableVideo(data: PublicVideoRankingDocument): boolean {
  return normalizeEnum(data.visibility) === 'PUBLIC' &&
    normalizeEnum(data.moderationStatus) === 'APPROVED';
}

function buildRankingUpdate(
  data: PublicVideoRankingDocument,
  now: number
): VideoRankingUpdate {
  const ranking = buildMediaEngagementScore({
    reactionsCount: normalizeMediaCount(
      data.reactionsCount ?? data.likesCount
    ),
    commentsCount: normalizeMediaCount(data.commentsCount),
    ratingsCount: normalizeMediaCount(data.ratingsCount),
    ratingAverage: normalizeMediaRatingAverage(data.ratingAverage),
    viewsCount: normalizeMediaCount(data.viewsCount),
    uniqueViewersCount: normalizeMediaCount(data.uniqueViewersCount),
    qualifiedViewsCount: normalizeMediaCount(data.qualifiedViewsCount),
    totalQualifiedPlaybackMs: normalizeMediaTotal(
      data.totalQualifiedPlaybackMs
    ),
    totalQualifiedDurationMs: normalizeMediaTotal(
      data.totalQualifiedDurationMs
    ),
    publishedAt: normalizeMediaTimestamp(data.publishedAt),
    now,
    currentBreakdown: data.scoreBreakdown,
  });

  return {
    score: ranking.score,
    engagementScore: ranking.engagementScore,
    viewScore: ranking.viewScore,
    retentionScore: ranking.retentionScore,
    freshnessScore: ranking.freshnessScore,
    scoreBreakdown: ranking.scoreBreakdown,
    rankingVersion: MEDIA_RANKING_VERSION,
    rankingUpdatedAt: now,
  };
}

function hasEquivalentRanking(
  data: PublicVideoRankingDocument,
  update: VideoRankingUpdate
): boolean {
  const currentBreakdown = data.scoreBreakdown ?? {};
  const nextBreakdown = update.scoreBreakdown;

  return normalizeMediaCount(data.rankingVersion) === MEDIA_RANKING_VERSION &&
    normalizeMediaScore(data.score) === update.score &&
    normalizeMediaScore(data.engagementScore) === update.engagementScore &&
    normalizeMediaScore(data.viewScore) === update.viewScore &&
    normalizeMediaScore(data.retentionScore) === update.retentionScore &&
    normalizeMediaScore(data.freshnessScore) === update.freshnessScore &&
    normalizeMediaScore(currentBreakdown.rankingScore) ===
      nextBreakdown.rankingScore &&
    normalizeMediaScore(currentBreakdown.qualityScore) ===
      nextBreakdown.qualityScore &&
    normalizeMediaScore(currentBreakdown.engagementScore) ===
      nextBreakdown.engagementScore &&
    normalizeMediaScore(currentBreakdown.viewScore) ===
      nextBreakdown.viewScore &&
    normalizeMediaScore(currentBreakdown.retentionScore) ===
      nextBreakdown.retentionScore &&
    normalizeMediaScore(currentBreakdown.freshnessScore) ===
      nextBreakdown.freshnessScore &&
    normalizeMediaScore(currentBreakdown.safetyScore) ===
      nextBreakdown.safetyScore;
}

export const recalculateVideoRankingOnWrite = onDocumentWritten(
  {
    document: 'public_profiles/{ownerUid}/public_videos/{videoId}',
    region: FUNCTIONS_REGION,
    maxInstances: 20,
  },
  async (event) => {
    const after = event.data?.after;

    if (!after?.exists) {
      return;
    }

    const data = after.data() as PublicVideoRankingDocument;

    if (!isRankableVideo(data)) {
      return;
    }

    const update = buildRankingUpdate(data, Date.now());

    if (hasEquivalentRanking(data, update)) {
      return;
    }

    await after.ref.set(update, { merge: true });
  }
);

export const refreshPublicVideoRankingScores = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    const rankableVideos = db
      .collectionGroup('public_videos')
      .where('visibility', '==', 'PUBLIC')
      .where('moderationStatus', '==', 'APPROVED');
    const [topSnapshot, latestSnapshot] = await Promise.all([
      rankableVideos
        .orderBy('score', 'desc')
        .limit(RANKING_REFRESH_LIMIT_PER_QUERY)
        .get(),
      rankableVideos
        .orderBy('publishedAt', 'desc')
        .limit(RANKING_REFRESH_LIMIT_PER_QUERY)
        .get(),
    ]);
    const candidates = new Map<
      string,
      FirebaseFirestore.QueryDocumentSnapshot
    >();

    for (const document of [...topSnapshot.docs, ...latestSnapshot.docs]) {
      candidates.set(document.ref.path, document);
    }

    const now = Date.now();
    const batch = db.batch();
    let updatedVideos = 0;

    for (const document of candidates.values()) {
      const data = document.data() as PublicVideoRankingDocument;

      if (!isRankableVideo(data)) {
        continue;
      }

      const update = buildRankingUpdate(data, now);

      if (hasEquivalentRanking(data, update)) {
        continue;
      }

      batch.set(document.ref, update, { merge: true });
      updatedVideos += 1;
    }

    if (updatedVideos > 0) {
      await batch.commit();
    }

    logger.info('[refreshPublicVideoRankingScores] Ranking atualizado.', {
      scannedVideos: candidates.size,
      updatedVideos,
      rankingVersion: MEDIA_RANKING_VERSION,
    });
  }
);
