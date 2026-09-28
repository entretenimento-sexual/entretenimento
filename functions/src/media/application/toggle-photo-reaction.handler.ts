// functions/src/media/application/toggle-photo-reaction.handler.ts
// -----------------------------------------------------------------------------
// TOGGLE PHOTO REACTION
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - receber intenção autenticada de curtir/descurtir foto acessível;
// - validar audiência, moderação e reactionsEnabled;
// - gravar/remover o like do usuário;
// - recalcular reactionsCount, engagementScore, rankingScore e score no backend.
//
// Segurança:
// - cliente não escreve score;
// - cliente não escreve contador;
// - cliente não escreve documento público da foto;
// - cada usuário só possui um like ativo por foto;
// - conta com interações bloqueadas não altera reações;
// - audiência é revalidada dentro da mesma transação da mutação.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessInTransaction,
} from '../../account_lifecycle/interaction-access.policy';
import { db } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import { observeMediaTrendScoreShadow } from './media-trend-score-shadow-observation.service';
import {
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  assertPublicMediaCallableAppCheck,
} from './public-media-callable-security';
import {
  assertPublicMediaConsumptionAccess,
} from './public-media-consumption-access.policy';
import {
  consumePublicPhotoSocialInteractionQuota,
} from './public-photo-social-interaction-rate-limit.service';
import {
  resolvePhotoAudienceAccessInTransaction,
} from './photo-audience-access.policy';

interface TogglePhotoReactionRequest {
  ownerUid?: string;
  photoId?: string;
}

type PublicPhotoDoc = {
  ownerUid?: string;
  visibility?: string;
  moderationStatus?: string;
  reactionsEnabled?: boolean;
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  score?: number;
  engagementScore?: number;
  publishedAt?: number;
  createdAt?: number;
  scoreBreakdown?: Partial<MediaScoreBreakdown>;
};

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function buildNextScore(
  photo: PublicPhotoDoc,
  nextReactionsCount: number
) {
  return buildMediaEngagementScore({
    reactionsCount: nextReactionsCount,
    commentsCount: normalizeMediaCount(photo.commentsCount),
    currentBreakdown: photo.scoreBreakdown,
  });
}

export const togglePhotoReaction = onCall<TogglePhotoReactionRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

    const viewerUid = request.auth?.uid ?? null;

    if (!viewerUid) {
      throw new HttpsError(
        'unauthenticated',
        'Usuário não autenticado.'
      );
    }

    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!ownerUid || !photoId) {
      throw new HttpsError(
        'invalid-argument',
        'Foto inválida.'
      );
    }

    if (ownerUid === viewerUid) {
      throw new HttpsError(
        'failed-precondition',
        'Você não pode reagir à própria foto.'
      );
    }

    await consumePublicPhotoSocialInteractionQuota('reaction', viewerUid);
    await assertPublicMediaConsumptionAccess(viewerUid);

    const photoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const likeRef = photoRef.collection('likes').doc(viewerUid);

    const outcome = await db.runTransaction(async (transaction) => {
      await assertInteractionAccessInTransaction(transaction, viewerUid);

      const photoSnap = await transaction.get(photoRef);

      if (!photoSnap.exists) {
        throw new HttpsError(
          'not-found',
          'Foto pública não encontrada.'
        );
      }

      const photo = photoSnap.data() as PublicPhotoDoc;

      if (photo.ownerUid !== ownerUid) {
        throw new HttpsError(
          'failed-precondition',
          'Foto inconsistente.'
        );
      }

      await resolvePhotoAudienceAccessInTransaction(
        transaction,
        viewerUid,
        ownerUid,
        photo.visibility,
        'Foto pública não encontrada.'
      );

      if (photo.moderationStatus !== 'APPROVED') {
        throw new HttpsError(
          'failed-precondition',
          'Esta foto ainda não está aprovada para reações.'
        );
      }

      if (photo.reactionsEnabled !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Reações desabilitadas nesta foto.'
        );
      }

      const likeSnap = await transaction.get(likeRef);
      const currentCount = normalizeMediaCount(
        photo.reactionsCount ?? photo.likesCount ?? 0
      );

      if (likeSnap.exists) {
        const nextCount = Math.max(0, currentCount - 1);
        const nextScore = buildNextScore(photo, nextCount);
        const now = Date.now();

        transaction.delete(likeRef);
        transaction.update(photoRef, {
          reactionsCount: nextCount,
          likesCount: nextCount,

          engagementScore: nextScore.engagementScore,
          score: nextScore.score,
          scoreBreakdown: nextScore.scoreBreakdown,

          updatedAt: now,
        });

        return {
          liked: false,
          reactionsCount: nextCount,
          score: nextScore.score,
          trendEngagementScore: nextScore.engagementScore,
          trendPublishedAt: photo.publishedAt ?? photo.createdAt ?? 0,
          trendObservedAt: now,
        };
      }

      const now = Date.now();
      const nextCount = currentCount + 1;
      const nextScore = buildNextScore(photo, nextCount);

      transaction.set(likeRef, {
        uid: viewerUid,
        createdAt: now,
      });

      transaction.update(photoRef, {
        reactionsCount: nextCount,
        likesCount: nextCount,

        engagementScore: nextScore.engagementScore,
        score: nextScore.score,
        scoreBreakdown: nextScore.scoreBreakdown,

        updatedAt: now,
      });

      return {
        liked: true,
        reactionsCount: nextCount,
        score: nextScore.score,
        trendEngagementScore: nextScore.engagementScore,
        trendPublishedAt: photo.publishedAt ?? photo.createdAt ?? 0,
        trendObservedAt: now,
      };
    });

    observeMediaTrendScoreShadow({
      mediaType: 'photo',
      event: 'reaction',
      engagementScore: outcome.trendEngagementScore,
      publishedAt: outcome.trendPublishedAt,
      now: outcome.trendObservedAt,
    });

    return {
      liked: outcome.liked,
      reactionsCount: outcome.reactionsCount,
      score: outcome.score,
    };
  }
);
