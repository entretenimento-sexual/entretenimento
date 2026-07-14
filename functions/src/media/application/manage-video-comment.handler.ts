import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from './media-engagement-score';

type VideoCommentStatus = 'VISIBLE' | 'HIDDEN' | 'DELETED';
type VideoCommentModerationAction = 'HIDE' | 'RESTORE' | 'DELETE';

interface PublicVideoDoc {
  ownerUid?: string;
  visibility?: string;
  moderationStatus?: string;
  commentsEnabled?: boolean;
  reactionsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  ratingsCount?: number;
  ratingAverage?: number;
  scoreBreakdown?: Partial<MediaScoreBreakdown>;
}

interface PublicProfileDoc {
  nickname?: string;
  displayName?: string;
  nome?: string;
  name?: string;
}

interface VideoCommentDoc {
  ownerUid: string;
  videoId: string;
  authorUid: string;
  authorNickname: string;
  content: string;
  status: VideoCommentStatus;
  parentCommentId: string | null;
  isOwnerReply: boolean;
  replyToAuthorUid: string | null;
  replyToAuthorNickname: string | null;
  likesCount: number;
  reportsCount: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface CreateVideoCommentRequest {
  ownerUid?: string;
  videoId?: string;
  content?: string;
  parentCommentId?: string | null;
}

interface ModerateVideoCommentRequest {
  ownerUid?: string;
  videoId?: string;
  commentId?: string;
  action?: VideoCommentModerationAction;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function replaceControlCharacters(value: string): string {
  let sanitized = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    sanitized += code <= 31 || code === 127 ? ' ' : value[index];
  }

  return sanitized;
}

function cleanContent(value: unknown): string {
  return replaceControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function resolveNickname(
  profile: PublicProfileDoc | undefined,
  fallback = 'Usuário'
): string {
  const value = profile?.nickname ??
    profile?.displayName ??
    profile?.nome ??
    profile?.name ??
    fallback;
  const nickname = String(value ?? '').trim();
  return nickname ? nickname.slice(0, 40) : fallback;
}

function assertVideoAllowsComments(video: PublicVideoDoc): void {
  if (video.visibility !== 'PUBLIC') {
    throw new HttpsError('failed-precondition', 'Este vídeo não está público.');
  }

  if (video.moderationStatus !== 'APPROVED') {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo ainda não está aprovado para comentários.'
    );
  }

  if (video.commentsEnabled !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Comentários desabilitados neste vídeo.'
    );
  }
}

export const createVideoComment = onCall<CreateVideoCommentRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ commentId: string }> => {
    const authorUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const content = cleanContent(request.data?.content);
    const parentCommentId = cleanId(request.data?.parentCommentId) || null;

    if (!authorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    if (!content) {
      throw new HttpsError('invalid-argument', 'Comentário vazio.');
    }

    const videoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const authorProfileRef = db.doc(`public_profiles/${authorUid}`);
    const commentsCollection = videoRef.collection('comments');
    const newCommentRef = commentsCollection.doc();

    return db.runTransaction(async (transaction) => {
      const [videoSnap, authorProfileSnap] = await Promise.all([
        transaction.get(videoRef),
        transaction.get(authorProfileRef),
      ]);

      if (!videoSnap.exists) {
        throw new HttpsError('not-found', 'Vídeo público não encontrado.');
      }

      const video = videoSnap.data() as PublicVideoDoc;

      if (video.ownerUid !== ownerUid) {
        throw new HttpsError('failed-precondition', 'Vídeo inconsistente.');
      }

      assertVideoAllowsComments(video);

      const authorNickname = resolveNickname(
        authorProfileSnap.exists
          ? authorProfileSnap.data() as PublicProfileDoc
          : undefined
      );
      let replyToAuthorUid: string | null = null;
      let replyToAuthorNickname: string | null = null;
      let isOwnerReply = false;

      if (parentCommentId) {
        if (authorUid !== ownerUid) {
          throw new HttpsError(
            'permission-denied',
            'Somente o dono do vídeo pode responder como perfil.'
          );
        }

        const parentRef = commentsCollection.doc(parentCommentId);
        const parentSnap = await transaction.get(parentRef);

        if (!parentSnap.exists) {
          throw new HttpsError('not-found', 'Comentário original não encontrado.');
        }

        const parent = parentSnap.data() as VideoCommentDoc;

        if (
          parent.ownerUid !== ownerUid ||
          parent.videoId !== videoId ||
          parent.status !== 'VISIBLE' ||
          parent.parentCommentId
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Comentário indisponível para resposta.'
          );
        }

        replyToAuthorUid = parent.authorUid;
        replyToAuthorNickname = parent.authorNickname;
        isOwnerReply = true;
      }

      const now = Date.now();
      const isRootComment = !parentCommentId;
      const currentCommentsCount = normalizeMediaCount(video.commentsCount);
      const nextCommentsCount = isRootComment
        ? currentCommentsCount + 1
        : currentCommentsCount;
      const nextScore = buildMediaEngagementScore({
        reactionsCount: normalizeMediaCount(
          video.reactionsCount ?? video.likesCount
        ),
        commentsCount: nextCommentsCount,
        ratingsCount: normalizeMediaCount(video.ratingsCount),
        ratingAverage: video.ratingAverage,
        currentBreakdown: video.scoreBreakdown,
      });
      const comment: VideoCommentDoc = {
        ownerUid,
        videoId,
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

      transaction.set(newCommentRef, comment);
      transaction.update(videoRef, {
        commentsCount: nextCommentsCount,
        engagementScore: nextScore.engagementScore,
        score: nextScore.score,
        scoreBreakdown: nextScore.scoreBreakdown,
        updatedAt: now,
      });

      return { commentId: newCommentRef.id };
    });
  }
);

export const moderateVideoComment = onCall<ModerateVideoCommentRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    status: VideoCommentStatus;
    commentsCount: number;
    score: number;
  }> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const commentId = cleanId(request.data?.commentId);
    const action = String(request.data?.action ?? '').trim().toUpperCase();

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId || !commentId) {
      throw new HttpsError('invalid-argument', 'Comentário inválido.');
    }

    if (!['HIDE', 'RESTORE', 'DELETE'].includes(action)) {
      throw new HttpsError('invalid-argument', 'Ação inválida.');
    }

    const videoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const commentRef = videoRef.collection('comments').doc(commentId);

    return db.runTransaction(async (transaction) => {
      const [videoSnap, commentSnap] = await Promise.all([
        transaction.get(videoRef),
        transaction.get(commentRef),
      ]);

      if (!videoSnap.exists || !commentSnap.exists) {
        throw new HttpsError('not-found', 'Comentário não encontrado.');
      }

      const video = videoSnap.data() as PublicVideoDoc;
      const comment = commentSnap.data() as VideoCommentDoc;

      if (
        video.ownerUid !== ownerUid ||
        comment.ownerUid !== ownerUid ||
        comment.videoId !== videoId
      ) {
        throw new HttpsError('failed-precondition', 'Comentário inconsistente.');
      }

      const isVideoOwner = requesterUid === ownerUid;
      const isCommentAuthor = requesterUid === comment.authorUid;

      if ((action === 'HIDE' || action === 'RESTORE') && !isVideoOwner) {
        throw new HttpsError(
          'permission-denied',
          'Somente o dono do vídeo pode moderar este comentário.'
        );
      }

      if (action === 'DELETE' && !isVideoOwner && !isCommentAuthor) {
        throw new HttpsError(
          'permission-denied',
          'Você não tem permissão para remover este comentário.'
        );
      }

      if (comment.status === 'DELETED') {
        throw new HttpsError('failed-precondition', 'Comentário já removido.');
      }

      let nextStatus: VideoCommentStatus = comment.status;
      let nextContent = comment.content;
      let deletedAt = comment.deletedAt;
      const affectsCount = !comment.parentCommentId;
      let countDelta = 0;

      if (action === 'HIDE') {
        if (affectsCount && comment.status === 'VISIBLE') {
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
        if (affectsCount) {
          countDelta = 1;
        }
        nextStatus = 'VISIBLE';
      }

      if (action === 'DELETE') {
        if (affectsCount && comment.status === 'VISIBLE') {
          countDelta = -1;
        }
        nextStatus = 'DELETED';
        nextContent = '';
        deletedAt = Date.now();
      }

      const now = Date.now();
      const nextCommentsCount = Math.max(
        0,
        normalizeMediaCount(video.commentsCount) + countDelta
      );
      const nextScore = buildMediaEngagementScore({
        reactionsCount: normalizeMediaCount(
          video.reactionsCount ?? video.likesCount
        ),
        commentsCount: nextCommentsCount,
        ratingsCount: normalizeMediaCount(video.ratingsCount),
        ratingAverage: video.ratingAverage,
        currentBreakdown: video.scoreBreakdown,
      });

      transaction.update(commentRef, {
        status: nextStatus,
        content: nextContent,
        updatedAt: now,
        deletedAt,
      });
      transaction.update(videoRef, {
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
