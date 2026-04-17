// src/app/core/interfaces/media/i-public-photo-item.ts
// Contrato da projeção pública de fotos.
//
// Uso:
// - leitura por outros usuários
// - perfil público / perfil de terceiros
// - não deve carregar metadados privados como path bruto do upload
import type { TPhotoVisibility } from './i-photo-publication-config';

export interface IPublicPhotoItem {
  id: string;
  ownerUid: string;

  url: string;
  alt?: string;

  createdAt: number;
  publishedAt: number;
  updatedAt?: number;

  visibility: TPhotoVisibility;

  isCover?: boolean;
  orderIndex: number;

  commentsEnabled?: boolean;
  reactionsEnabled?: boolean;

  // métricas / vitrines públicas
  likesCount?: number;
  commentsCount?: number;
  engagementScore?: number;

  // turbo / promoção
  boostActive?: boolean;
  boostPriority?: number;
  boostedUntil?: number | null;
}