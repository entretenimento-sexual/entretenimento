// src/app/core/interfaces/media/i-private-photo-item.ts
export type TPhotoPublicationStatus = 'PRIVATE' | 'PUBLISHED' | 'ARCHIVED';

export interface IPrivatePhotoItem {
  id: string;
  ownerUid: string;

  // exibição privada / gestão
  url: string;
  alt?: string;

  // metadados técnicos privados
  path?: string;
  fileName?: string;

  createdAt: number;
  updatedAt?: number;

  // estado de publicação
  publicationStatus: TPhotoPublicationStatus;
  isCover?: boolean;
  orderIndex?: number;

  // referência opcional ao item público projetado
  publicPhotoId?: string | null;
  publishedAt?: number | null;
}