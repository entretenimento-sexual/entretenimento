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

interface ToggleVideoReactionRequest {
  ownerUid?: string;
  videoId?: string;
}

interface PublicVideoDoc extends PublicVideoAudienceDocument {
  reactionsEnabled?: boolean;
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

    const audience = await createVideoAudienceAccessEvaluator(viewerUid);
    const videoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const likeRef = videoRef.collection('likes').doc(viewerUid);

    return db.runTransaction(async (transaction) => {
      const [videoSnap, publicationSnap, likeSnap] = await Promise.all([
        transaction.get(videoRef),
        transaction.get(publicationRef),
        transaction.get(likeRef),
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

      /**
       * Remover a própria reação é limpeza de dado e permanece disponível
       * mesmo após revogação de audiência. Criar uma reação exige autorização.
       */
      if (!likeSnap.exists) {
        await audience.assertInTransaction(transaction, target);

        if (video.reactionsEnabled !== true) {
          throw new HttpsError(
            'failed-precondition',
            'Curtidas desabilitadas neste vídeo.'
          );
        }
      }

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

      transaction.update(videoRef, {
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
