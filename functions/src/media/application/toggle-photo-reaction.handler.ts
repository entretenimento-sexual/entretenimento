// functions/src/media/application/toggle-photo-reaction.handler.ts
// -----------------------------------------------------------------------------
// TOGGLE PHOTO REACTION
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - receber intenção autenticada de curtir/descurtir foto pública;
// - validar que a foto está PUBLIC + APPROVED + reactionsEnabled;
// - gravar/remover o like do usuário;
// - recalcular o ranking pela infraestrutura canônica de mídia.
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
import {
  buildPhotoRankingUpdate,
  type PublicPhotoRankingDocument,
} from './photo-ranking-score';
import { normalizeMediaCount } from './media-engagement-score';

interface TogglePhotoReactionRequest {
  ownerUid?: string;
  photoId?: string;
}

type PublicPhotoDoc = PublicPhotoRankingDocument & {
  ownerUid?: string;
  visibility?: string;
  moderationStatus?: string;
  reactionsEnabled?: boolean;
};

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function buildRankingFields(
  photo: PublicPhotoDoc,
  nextReactionsCount: number,
  now: number
) {
  const ranking = buildPhotoRankingUpdate(photo, now, {
    reactionsCount: nextReactionsCount,
  });

  return {
    engagementScore: ranking.engagementScore,
    viewScore: ranking.viewScore,
    retentionScore: ranking.retentionScore,
    freshnessScore: ranking.freshnessScore,
    score: ranking.score,
    scoreBreakdown: ranking.scoreBreakdown,
    rankingVersion: ranking.rankingVersion,
    rankingUpdatedAt: ranking.rankingUpdatedAt,
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
      const currentCount = normalizeMediaCount(
        photo.reactionsCount ?? photo.likesCount
      );
      const now = Date.now();

      if (likeSnap.exists) {
        const nextCount = Math.max(0, currentCount - 1);
        const rankingFields = buildRankingFields(photo, nextCount, now);

        transaction.delete(likeRef);
        transaction.update(photoRef, {
          reactionsCount: nextCount,
          likesCount: nextCount,
          ...rankingFields,
          updatedAt: now,
        });

        return {
          liked: false,
          reactionsCount: nextCount,
          score: rankingFields.score,
        };
      }

      const nextCount = currentCount + 1;
      const rankingFields = buildRankingFields(photo, nextCount, now);

      transaction.set(likeRef, {
        uid: viewerUid,
        createdAt: now,
      });

      transaction.update(photoRef, {
        reactionsCount: nextCount,
        likesCount: nextCount,
        ...rankingFields,
        updatedAt: now,
      });

      return {
        liked: true,
        reactionsCount: nextCount,
        score: rankingFields.score,
      };
    });
  }
);
