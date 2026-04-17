// src/app/core/interfaces/media/i-photo-publication-config.ts
// Estado/configuração de publicação da foto.
//
// IMPORTANTE:
// - este contrato NÃO representa o documento privado em users/{uid}/photos/{photoId}
// - ele representa a camada separada de publicação
// - isso evita misturar acervo privado com exposição pública
export type TPhotoVisibility = 'PRIVATE' | 'FRIENDS' | 'SUBSCRIBERS' | 'PUBLIC';

export interface IPhotoPublicationConfig {
  photoId: string;
  ownerUid: string;

  isPublished: boolean;
  visibility: TPhotoVisibility;

  isCover?: boolean;
  orderIndex?: number;

  commentsEnabled?: boolean;
  reactionsEnabled?: boolean;

  publishedAt?: number | null;
  updatedAt?: number;
}