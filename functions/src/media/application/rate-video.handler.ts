import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessInTransaction,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import {
  buildNextVideoRatingAggregate,
  normalizeVideoRating,
} from './video-rating-aggregate';

interface RateVideoRequest {
  ownerUid?: string;
  videoId?: string;
  rating?: number;
}

interface PublicVideoDoc {
  ownerUid?: string;
  visibility?: string;
  moderationStatus?: string;
  ratingsEnabled?: boolean;
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  ratingsCount?: number;
  ratingTotal?: number;
  ratingAverage?: number;
  scoreBreakdown?: Partial<MediaScoreBreakdown>;
}

interface VideoRatingDoc {
  uid?: string;
  rating?: number;
  createdAt?: number;
  updatedAt?: number;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function assertRateableVideo(video: PublicVideoDoc): void {
  if (video.visibility !== 'PUBLIC') {
    throw new HttpsError('failed-precondition', 'Este vídeo não está público.');
  }

  if (video.moderationStatus !== 'APPROVED') {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo ainda não está aprovado para avaliações.'
    );
  }

  if (video.ratingsEnabled !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Avaliações desabilitadas neste vídeo.'
    );
  }
}

export const rateVideo = onCall<RateVideoRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const viewerUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const rating = normalizeVideoRating(request.data?.rating);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId || rating === null) {
      throw new HttpsError(
        'invalid-argument',
        'Informe uma avaliação inteira entre 1 e 5.'
      );
    }

    if (ownerUid === viewerUid) {
      throw new HttpsError(
        'failed-precondition',
        'Você não pode avaliar o próprio vídeo.'
      );
    }

    const videoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const ratingRef = videoRef.collection('ratings').doc(viewerUid);

    return db.runTransaction(async (transaction) => {
      await assertInteractionAccessInTransaction(transaction, viewerUid);

      const [videoSnap, ratingSnap] = await Promise.all([
        transaction.get(videoRef),
        transaction.get(ratingRef),
      ]);

      if (!videoSnap.exists) {
        throw new HttpsError('not-found', 'Vídeo público não encontrado.');
      }

      const video = videoSnap.data() as PublicVideoDoc;

      if (video.ownerUid !== ownerUid) {
        throw new HttpsError('failed-precondition', 'Vídeo inconsistente.');
      }

      assertRateableVideo(video);

      const currentRating = ratingSnap.exists
        ? ratingSnap.data() as VideoRatingDoc
        : null;
      const previousRating = normalizeVideoRating(currentRating?.rating);
      const nextAggregate = buildNextVideoRatingAggregate(
        video,
        previousRating,
        rating
      );
      const nextScore = buildMediaEngagementScore({
        reactionsCount: normalizeMediaCount(
          video.reactionsCount ?? video.likesCount
        ),
        commentsCount: normalizeMediaCount(video.commentsCount),
        ratingsCount: nextAggregate.ratingsCount,
        ratingAverage: nextAggregate.ratingAverage,
        currentBreakdown: video.scoreBreakdown,
      });
      const now = Date.now();

      transaction.set(ratingRef, {
        uid: viewerUid,
        rating,
        createdAt: currentRating?.createdAt ?? now,
        updatedAt: now,
      });
      transaction.update(videoRef, {
        ...nextAggregate,
        engagementScore: nextScore.engagementScore,
        score: nextScore.score,
        scoreBreakdown: nextScore.scoreBreakdown,
        updatedAt: now,
      });

      return {
        rating,
        ratingsCount: nextAggregate.ratingsCount,
        ratingAverage: nextAggregate.ratingAverage,
        score: nextScore.score,
      };
    });
  }
);
