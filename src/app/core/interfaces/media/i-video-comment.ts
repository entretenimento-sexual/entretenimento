export type TVideoCommentStatus = 'VISIBLE' | 'HIDDEN' | 'DELETED';

export interface IVideoComment {
  id: string;
  ownerUid: string;
  videoId: string;

  authorUid: string;
  authorNickname: string;

  content: string;
  status: TVideoCommentStatus;

  parentCommentId: string | null;
  isOwnerReply: boolean;
  replyToAuthorUid: string | null;
  replyToAuthorNickname: string | null;

  likesCount: number;
  reportsCount: number;

  createdAt: number;
  updatedAt?: number;
  deletedAt: number | null;
}
