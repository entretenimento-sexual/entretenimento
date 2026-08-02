import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import {
  createVideoAudienceAccessEvaluator,
  resolveCanonicalVideoAudienceTarget,
  type PublicVideoAudienceDocument,
  type VideoPublicationAudienceDocument,
} from './video-audience-access.policy';
import {
  buildNextVideoRatingAggregate,
  normalizeVideoRating,
} from './video-rating-aggregate';

interface RateVideoRequest {
  ownerUid?: string;
  videoId?: string;
  rating?: number;
}

interface PublicVideoDoc extends PublicVideoAudienceDocument {
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

    const audience = await createVideoAudienceAccessEvaluator(viewerUid);
    const videoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const ratingRef = videoRef.collection('ratings').doc(viewerUid);

    return db.runTransaction(async (transaction) => {
      const [videoSnap, publicationSnap, ratingSnap] = await Promise.all([
        transaction.get(videoRef),
        transaction.get(publicationRef),
        transaction.get(ratingRef),
      ]);

      if (!videoSnap.exists || !publicationSnap.exists) {
        throw new HttpsError('not-found', 'Vídeo público não encontrado.');
      }

      const video = videoSnap.data() as PublicVideoDoc;
      const publication =
        publicationSnap.data() as VideoPublicationAudienceDocument;
      const target = resolveCanonicalVideoAudienceTarget({
        ownerUid,
        videoId,
        action: 'INTERACT',
        publicVideo: video,
        publication,
      });

      if (!target) {
        throw new HttpsError(
          'failed-precondition',
          'O vídeo possui dados de publicação inconsistentes.'
        );
      }

      await audience.assertInTransaction(transaction, target);

      if (video.ratingsEnabled !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Avaliações desabilitadas neste vídeo.'
        );
      }

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
