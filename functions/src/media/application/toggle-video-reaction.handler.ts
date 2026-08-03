import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import {
  createVideoInteractionAccessAuthorizer,
} from './video-interaction-access.service';
import {
  assertVideoInteractionCapability,
} from './video-interaction-capability.policy';

interface ToggleVideoReactionRequest {
  ownerUid?: string;
  videoId?: string;
}

interface PublicVideoDoc {
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  ratingsCount?: number;
  ratingAverage?: number;
  scoreBreakdown?: Partial<MediaScoreBreakdown>;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

export const toggleVideoReaction = onCall<ToggleVideoReactionRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const viewerUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    if (ownerUid === viewerUid) {
      throw new HttpsError(
        'failed-precondition',
        'Você não pode curtir o próprio vídeo.'
      );
    }

    const authorizer = await createVideoInteractionAccessAuthorizer({
      viewerUid,
      ownerUid,
      authenticatedEmailVerified:
        request.auth?.token.email_verified === true,
    });

    return db.runTransaction(async (transaction) => {
      const access = await authorizer.assertInTransaction(
        transaction,
        videoId
      );
      const likeRef = access.videoRef.collection('likes').doc(viewerUid);
      const likeSnap = await transaction.get(likeRef);
      const video = access.publicVideo as PublicVideoDoc;

      assertVideoInteractionCapability({
        capability: 'REACTION',
        publicVideo: access.publicVideo,
        publication: access.publication,
      });

      const currentCount = normalizeMediaCount(
        video.reactionsCount ?? video.likesCount ?? 0
      );
      const nextCount = likeSnap.exists
        ? Math.max(0, currentCount - 1)
        : currentCount + 1;
      const nextScore = buildMediaEngagementScore({
        reactionsCount: nextCount,
        commentsCount: normalizeMediaCount(video.commentsCount),
        ratingsCount: normalizeMediaCount(video.ratingsCount),
        ratingAverage: video.ratingAverage,
        currentBreakdown: video.scoreBreakdown,
      });
      const now = Date.now();

      if (likeSnap.exists) {
        transaction.delete(likeRef);
      } else {
        transaction.set(likeRef, {
          uid: viewerUid,
          createdAt: now,
        });
      }

      transaction.update(access.videoRef, {
        reactionsCount: nextCount,
        likesCount: nextCount,
        engagementScore: nextScore.engagementScore,
        score: nextScore.score,
        scoreBreakdown: nextScore.scoreBreakdown,
        updatedAt: now,
      });

      return {
        liked: !likeSnap.exists,
        reactionsCount: nextCount,
        score: nextScore.score,
      };
    });
  }
);
