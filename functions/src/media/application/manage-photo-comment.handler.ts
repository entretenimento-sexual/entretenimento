// functions/src/media/application/manage-photo-comment.handler.ts
// -----------------------------------------------------------------------------
// PHOTO COMMENTS — CREATE / REPLY / MODERATE
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - criar comentário em foto pública aprovada;
// - permitir resposta do dono da foto a um comentário;
// - permitir moderação pelo dono da foto;
// - permitir remoção suave pelo autor do comentário;
// - atualizar commentsCount e score no backend.
//
// Segurança:
// - cliente não edita comentário diretamente;
// - cliente não atualiza commentsCount/score;
// - nickname do autor é resolvido pelo backend a partir da projeção pública;
// - resposta encadeada é limitada a 1 nível para manter UX mobile limpa.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

type CommentStatus = 'VISIBLE' | 'PENDING_REVIEW' | 'HIDDEN' | 'DELETED';

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
  commentsEnabled?: boolean;
  commentsPolicy?: string;
  reactionsEnabled?: boolean;
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  score?: number;
  engagementScore?: number;
  scoreBreakdown?: Partial<ScoreBreakdown>;
};

type PublicProfileDoc = {
  nickname?: string;
  displayName?: string;
  nome?: string;
  name?: string;
};

type PhotoCommentDoc = {
  ownerUid: string;
  photoId: string;

  authorUid: string;
  authorNickname: string;

  content: string;
  status: CommentStatus;

  parentCommentId: string | null;
  isOwnerReply: boolean;
  replyToAuthorUid: string | null;
  replyToAuthorNickname: string | null;

  likesCount: number;
  reportsCount: number;

  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

interface CreatePhotoCommentRequest {
  ownerUid?: string;
  photoId?: string;
  content?: string;
  parentCommentId?: string | null;
}

interface CreatePhotoCommentResponse {
  commentId: string;
}

interface ModeratePhotoCommentRequest {
  ownerUid?: string;
  photoId?: string;
  commentId?: string;
  action?: 'HIDE' | 'RESTORE' | 'DELETE';
}

interface ModeratePhotoCommentResponse {
  status: CommentStatus;
  commentsCount: number;
  score: number;
}

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanContent(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 500);
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
  nextCommentsCount: number
): {
  score: number;
  engagementScore: number;
  scoreBreakdown: ScoreBreakdown;
} {
  const currentBreakdown = photo.scoreBreakdown ?? {};
  const reactionsCount = normalizeCount(photo.reactionsCount ?? photo.likesCount ?? 0);

  const engagementScore = calculateEngagementScore({
    reactionsCount,
    commentsCount: nextCommentsCount,
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

function assertPublicPhotoAllowsComments(photo: PublicPhotoDoc): void {
  if (photo.visibility !== 'PUBLIC') {
    throw new HttpsError('failed-precondition', 'Esta foto não está pública.');
  }

  if (photo.moderationStatus !== 'APPROVED') {
    throw new HttpsError(
      'failed-precondition',
      'Esta foto ainda não está aprovada para comentários.'
    );
  }

  if (photo.commentsEnabled !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Comentários desabilitados nesta foto.'
    );
  }

  if (photo.commentsPolicy !== 'EVERYONE') {
    throw new HttpsError(
      'failed-precondition',
      'A política atual da foto não permite comentários públicos.'
    );
  }
}

function resolveNickname(profile: PublicProfileDoc | undefined, fallback = 'Usuário'): string {
  const nickname =
    profile?.nickname ??
    profile?.displayName ??
    profile?.nome ??
    profile?.name ??
    fallback;

  const safeNickname = String(nickname ?? '').trim();

  return safeNickname ? safeNickname.slice(0, 40) : fallback;
}

export const createPhotoComment = onCall<CreatePhotoCommentRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CreatePhotoCommentResponse> => {
    const authorUid = request.auth?.uid ?? null;

    if (!authorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);
    const content = cleanContent(request.data?.content);
    const parentCommentId = cleanId(request.data?.parentCommentId) || null;

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    if (!content) {
      throw new HttpsError('invalid-argument', 'Comentário vazio.');
    }

    if (content.length > 500) {
      throw new HttpsError('invalid-argument', 'Comentário muito longo.');
    }

    const photoRef = db.doc(`public_profiles/${ownerUid}/public_photos/${photoId}`);
    const authorProfileRef = db.doc(`public_profiles/${authorUid}`);
    const commentsCollection = photoRef.collection('comments');
    const newCommentRef = commentsCollection.doc();

    return db.runTransaction(async (transaction) => {
      const [photoSnap, authorProfileSnap] = await Promise.all([
        transaction.get(photoRef),
        transaction.get(authorProfileRef),
      ]);

      if (!photoSnap.exists) {
        throw new HttpsError('not-found', 'Foto pública não encontrada.');
      }

      const photo = photoSnap.data() as PublicPhotoDoc;

      if (photo.ownerUid !== ownerUid) {
        throw new HttpsError('failed-precondition', 'Foto inconsistente.');
      }

      assertPublicPhotoAllowsComments(photo);

      const authorNickname = resolveNickname(
        authorProfileSnap.exists ? (authorProfileSnap.data() as PublicProfileDoc) : undefined
      );

      let replyToAuthorUid: string | null = null;
      let replyToAuthorNickname: string | null = null;
      let isOwnerReply = false;

      if (parentCommentId) {
        if (authorUid !== ownerUid) {
          throw new HttpsError(
            'permission-denied',
            'Somente o dono da foto pode responder comentários nesta etapa.'
          );
        }

        const parentRef = commentsCollection.doc(parentCommentId);
        const parentSnap = await transaction.get(parentRef);

        if (!parentSnap.exists) {
          throw new HttpsError('not-found', 'Comentário original não encontrado.');
        }

        const parent = parentSnap.data() as PhotoCommentDoc;

        if (
          parent.ownerUid !== ownerUid ||
          parent.photoId !== photoId ||
          parent.status !== 'VISIBLE'
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Comentário original indisponível para resposta.'
          );
        }

        if (parent.parentCommentId) {
          throw new HttpsError(
            'failed-precondition',
            'Respostas encadeadas não são permitidas.'
          );
        }

        replyToAuthorUid = parent.authorUid;
        replyToAuthorNickname = parent.authorNickname;
        isOwnerReply = true;
      }

      const now = Date.now();
      const isRootComment = !parentCommentId;
      const currentCommentsCount = normalizeCount(photo.commentsCount ?? 0);
      const nextCommentsCount = isRootComment
        ? currentCommentsCount + 1
        : currentCommentsCount;
      const nextScore = buildNextScore(photo, nextCommentsCount);

      const commentDoc: PhotoCommentDoc = {
        ownerUid,
        photoId,

        authorUid,
        authorNickname,

        content,
        status: 'VISIBLE',

        parentCommentId,
        isOwnerReply,
        replyToAuthorUid,
        replyToAuthorNickname,

        likesCount: 0,
        reportsCount: 0,

        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      transaction.set(newCommentRef, commentDoc);

      transaction.update(photoRef, {
        commentsCount: nextCommentsCount,
        engagementScore: nextScore.engagementScore,
        score: nextScore.score,
        scoreBreakdown: nextScore.scoreBreakdown,
        updatedAt: now,
      });

      return {
        commentId: newCommentRef.id,
      };
    });
  }
);

export const moderatePhotoComment = onCall<ModeratePhotoCommentRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ModeratePhotoCommentResponse> => {
    const requesterUid = request.auth?.uid ?? null;

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);
    const commentId = cleanId(request.data?.commentId);
    const action = String(request.data?.action ?? '').trim().toUpperCase();


    if (!ownerUid || !photoId || !commentId) {
      throw new HttpsError('invalid-argument', 'Comentário inválido.');
    }

    if (!['HIDE', 'RESTORE', 'DELETE'].includes(action)) {
      throw new HttpsError('invalid-argument', 'Ação inválida.');
    }

    const photoRef = db.doc(`public_profiles/${ownerUid}/public_photos/${photoId}`);
    const commentRef = photoRef.collection('comments').doc(commentId);

    return db.runTransaction(async (transaction) => {
      const [photoSnap, commentSnap] = await Promise.all([
        transaction.get(photoRef),
        transaction.get(commentRef),
      ]);

      if (!photoSnap.exists) {
        throw new HttpsError('not-found', 'Foto pública não encontrada.');
      }

      if (!commentSnap.exists) {
        throw new HttpsError('not-found', 'Comentário não encontrado.');
      }

      const photo = photoSnap.data() as PublicPhotoDoc;
      const comment = commentSnap.data() as PhotoCommentDoc;

      if (photo.ownerUid !== ownerUid) {
        throw new HttpsError('failed-precondition', 'Foto inconsistente.');
      }

      if (comment.ownerUid !== ownerUid || comment.photoId !== photoId) {
        throw new HttpsError('failed-precondition', 'Comentário inconsistente.');
      }

      const isPhotoOwner = requesterUid === ownerUid;
      const isCommentAuthor = requesterUid === comment.authorUid;

      if (action === 'HIDE' || action === 'RESTORE') {
        if (!isPhotoOwner) {
          throw new HttpsError(
            'permission-denied',
            'Somente o dono da foto pode moderar este comentário.'
          );
        }
      }

      if (action === 'DELETE' && !isPhotoOwner && !isCommentAuthor) {
        throw new HttpsError(
          'permission-denied',
          'Você não tem permissão para remover este comentário.'
        );
      }

      if (comment.status === 'DELETED') {
        throw new HttpsError(
          'failed-precondition',
          'Comentário já removido.'
        );
      }

      let nextStatus: CommentStatus = comment.status;
      let nextContent = comment.content;
      let deletedAt: number | null = comment.deletedAt ?? null;

      const affectsPublicCommentCount = !comment.parentCommentId;
      let countDelta = 0;

      if (action === 'HIDE') {
        if (affectsPublicCommentCount && comment.status === 'VISIBLE') {
          countDelta = -1;
        }

        nextStatus = 'HIDDEN';
      }

      if (action === 'RESTORE') {
        if (comment.status !== 'HIDDEN') {
          throw new HttpsError(
            'failed-precondition',
            'Somente comentários ocultos podem ser restaurados.'
          );
        }

        if (affectsPublicCommentCount) {
          countDelta = 1;
        }

        nextStatus = 'VISIBLE';
      }

      if (action === 'DELETE') {
        if (affectsPublicCommentCount && comment.status === 'VISIBLE') {
          countDelta = -1;
        }

        nextStatus = 'DELETED';
        nextContent = '';
        deletedAt = Date.now();
      }

      const now = Date.now();
      const currentCommentsCount = normalizeCount(photo.commentsCount ?? 0);
      const nextCommentsCount = Math.max(0, currentCommentsCount + countDelta);
      const nextScore = buildNextScore(photo, nextCommentsCount);

      transaction.update(commentRef, {
        status: nextStatus,
        content: nextContent,
        updatedAt: now,
        deletedAt,
      });

      transaction.update(photoRef, {
        commentsCount: nextCommentsCount,
        engagementScore: nextScore.engagementScore,
        score: nextScore.score,
        scoreBreakdown: nextScore.scoreBreakdown,
        updatedAt: now,
      });

      return {
        status: nextStatus,
        commentsCount: nextCommentsCount,
        score: nextScore.score,
      };
    });
  }
);
