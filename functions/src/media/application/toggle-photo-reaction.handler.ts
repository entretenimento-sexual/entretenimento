// functions/src/media/application/toggle-photo-reaction.handler.ts
// -----------------------------------------------------------------------------
// TOGGLE PHOTO REACTION
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - receber intenção autenticada de curtir/descurtir foto pública;
// - validar que a foto está PUBLIC + APPROVED + reactionsEnabled;
// - gravar/remover o like do usuário;
// - recalcular reactionsCount, engagementScore, rankingScore e score no backend.
//
// Segurança:
// - cliente não escreve score;
// - cliente não escreve contador;
// - cliente não escreve documento público da foto;
// - cada usuário só possui um like ativo por foto;
// - conta com interações bloqueadas não altera reações.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessInTransaction,
} from '../../account_lifecycle/interaction-access.policy';
import { db } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

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
  ownerUid?: string;
  visibility?: string;
  moderationStatus?: string;
  reactionsEnabled?: boolean;
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  score?: number;
  engagementScore?: number;
  scoreBreakdown?: Partial<ScoreBreakdown>;
};

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
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

    const photoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );

    const likeRef = photoRef.collection('likes').doc(viewerUid);

    return db.runTransaction(async (transaction) => {
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

      if (photo.visibility !== 'PUBLIC') {
        throw new HttpsError(
          'failed-precondition',
          'Esta foto não está pública.'
        );
      }

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
      const currentCount = normalizeCount(
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
      };
    });
  }
);
