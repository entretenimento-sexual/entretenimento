// functions/src/media/application/toggle-photo-reaction.handler.ts
// -----------------------------------------------------------------------------
// TOGGLE PHOTO REACTION
// -----------------------------------------------------------------------------
// Autorização:
// - visitante e autor precisam estar operacionais;
// - bloqueio bilateral e audiência são reavaliados dentro da transação;
// - projeção pública e publicação privada precisam concordar;
// - cliente não escreve score, contador ou documento público.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  createPhotoInteractionAccessAuthorizer,
} from './photo-interaction-access.service';

interface TogglePhotoReactionRequest {
  ownerUid?: string;
  photoId?: string;
}

type ScoreBreakdown = {
  rankingScore: number;
  qualityScore: number;
  engagementScore: number;
  safetyScore: number;
};

type PublicPhotoDoc = {
  reactionsEnabled?: boolean;
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  score?: number;
  engagementScore?: number;
  scoreBreakdown?: Partial<ScoreBreakdown>;
};

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeCount(value: unknown): number {
  const count = Number(value ?? 0);

  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }

  return Math.floor(count);
}

function normalizeScore(value: unknown): number {
  const score = Number(value ?? 0);

  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateEngagementScore(input: {
  reactionsCount: number;
  commentsCount: number;
}): number {
  const weightedEngagement =
    input.reactionsCount * 2 +
    input.commentsCount * 4;

  return normalizeScore(Math.round(Math.log1p(weightedEngagement) * 18));
}

function calculateRankingScore(score: ScoreBreakdown): number {
  const quality = normalizeScore(score.qualityScore);
  const engagement = normalizeScore(score.engagementScore);
  const safety = normalizeScore(score.safetyScore);

  return normalizeScore(
    Math.round(
      quality * 0.25 +
      engagement * 0.45 +
      safety * 0.30
    )
  );
}

function buildNextScore(
  photo: PublicPhotoDoc,
  nextReactionsCount: number
): {
  score: number;
  engagementScore: number;
  scoreBreakdown: ScoreBreakdown;
} {
  const currentBreakdown = photo.scoreBreakdown ?? {};
  const commentsCount = normalizeCount(photo.commentsCount ?? 0);
  const engagementScore = calculateEngagementScore({
    reactionsCount: nextReactionsCount,
    commentsCount,
  });
  const scoreBreakdown: ScoreBreakdown = {
    qualityScore: normalizeScore(currentBreakdown.qualityScore ?? 0),
    safetyScore: normalizeScore(currentBreakdown.safetyScore ?? 100),
    engagementScore,
    rankingScore: 0,
  };

  scoreBreakdown.rankingScore = calculateRankingScore(scoreBreakdown);

  return {
    score: scoreBreakdown.rankingScore,
    engagementScore,
    scoreBreakdown,
  };
}

export const togglePhotoReaction = onCall<TogglePhotoReactionRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    if (ownerUid === viewerUid) {
      throw new HttpsError(
        'failed-precondition',
        'Você não pode reagir à própria foto.'
      );
    }

    const authorizer = await createPhotoInteractionAccessAuthorizer({
      viewerUid,
      ownerUid,
      authenticatedEmailVerified:
        request.auth?.token.email_verified === true,
    });

    return db.runTransaction(async (transaction) => {
      const access = await authorizer.assertInTransaction(
        transaction,
        photoId
      );
      const photoRef = access.photoRef;
      const likeRef = photoRef.collection('likes').doc(viewerUid);
      const likeSnap = await transaction.get(likeRef);
      const photo = access.publicPhoto as PublicPhotoDoc;

      if (photo.reactionsEnabled !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Reações desabilitadas nesta foto.'
        );
      }

      const currentCount = normalizeCount(
        photo.reactionsCount ?? photo.likesCount ?? 0
      );
      const nextCount = likeSnap.exists
        ? Math.max(0, currentCount - 1)
        : currentCount + 1;
      const nextScore = buildNextScore(photo, nextCount);
      const now = Date.now();

      if (likeSnap.exists) {
        transaction.delete(likeRef);
      } else {
        transaction.set(likeRef, {
          uid: viewerUid,
          createdAt: now,
        });
      }

      transaction.update(photoRef, {
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
