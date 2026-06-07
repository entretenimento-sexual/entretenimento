// src/app/core/interfaces/media/i-photo-comment.ts
// Comentários públicos de fotos.
//
// Caminho previsto:
// public_profiles/{ownerUid}/public_photos/{photoId}/comments/{commentId}
//
// Regras de produto:
// - comentário só deve existir em foto pública aprovada;
// - commentsEnabled precisa estar true;
// - commentsPolicy define quem pode comentar;
// - comentário nasce VISIBLE ou PENDING_REVIEW conforme política futura;
// - comentário deletado não deve sumir fisicamente de imediato em produção;
// - dados sensíveis do autor não entram aqui.
export type TPhotoCommentStatus =
  | 'VISIBLE'
  | 'PENDING_REVIEW'
  | 'HIDDEN'
  | 'DELETED';

export interface IPhotoComment {
  id: string;

  ownerUid: string;
  photoId: string;

  authorUid: string;
  authorNickname: string;

  content: string;

  status: TPhotoCommentStatus;

  likesCount?: number;
  reportsCount?: number;

  createdAt: number;
  updatedAt?: number;
  deletedAt?: number | null;
}