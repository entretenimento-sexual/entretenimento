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
// - dados sensíveis do autor não entram aqui;
// - respostas são limitadas a 1 nível para preservar UX mobile;
// - resposta do dono da foto deve ser destacada visualmente.

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

  /**
   * Resposta simples, sem árvore infinita.
   * Quando preenchido, o comentário é resposta a outro comentário.
   */
  parentCommentId?: string | null;

  /**
   * true quando o dono da foto respondeu.
   * Isso permite destacar “Resposta do perfil” na UI.
   */
  isOwnerReply?: boolean;

  replyToAuthorUid?: string | null;
  replyToAuthorNickname?: string | null;

  likesCount?: number;
  reportsCount?: number;

  createdAt: number;
  updatedAt?: number;
  deletedAt?: number | null;
}
