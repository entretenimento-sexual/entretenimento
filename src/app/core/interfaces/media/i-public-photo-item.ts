// src/app/core/interfaces/media/i-public-photo-item.ts
// Contratos da projeção pública e do item hidratado para exibição.
//
// Segurança:
// - a projeção Firestore não precisa armazenar URL permanente;
// - o item exibido recebe URL temporária emitida pelo backend;
// - nenhum contrato público contém caminho do upload privado.

import type {
  IPhotoPublicationScore,
  TPhotoCommentsPolicy,
  TPhotoModerationStatus,
  TPhotoVisibility,
} from './i-photo-publication-config';

export type TPublicMediaType = 'PHOTO' | 'VIDEO';
export type TPublicAssetAccess = 'SIGNED_URL';

export interface IPublicPhotoBase {
  id: string;
  ownerUid: string;

  alt?: string;
  caption?: string | null;
  mediaType?: 'PHOTO';
  assetAccess?: TPublicAssetAccess;

  createdAt: number;
  publishedAt: number;
  updatedAt?: number;

  visibility: TPhotoVisibility;

  isCover?: boolean;
  orderIndex: number;

  commentsEnabled?: boolean;
  commentsPolicy?: TPhotoCommentsPolicy;
  commentsCount?: number;

  reactionsEnabled?: boolean;
  reactionsCount?: number;

  moderationStatus?: TPhotoModerationStatus;
  reportsCount?: number;

  score?: number;
  scoreBreakdown?: IPhotoPublicationScore;

  likesCount?: number;
  engagementScore?: number;
  viewsCount?: number;
  uniqueViewersCount?: number;
  lastViewedAt?: number;
  viewScore?: number;

  boostActive?: boolean;
  boostPriority?: number;
  boostedUntil?: number | null;

  ownerNickname?: string | null;
  ownerPhotoURL?: string | null;
  ownerGender?: string | null;
  ownerOrientation?: string | null;
  ownerMunicipio?: string | null;
  ownerEstado?: string | null;
}

/** Documento lido da projeção pública antes da autorização de acesso. */
export interface IPublicPhotoProjection extends IPublicPhotoBase {
  url?: string | null;
}

/** Item pronto para renderização após receber URL temporária. */
export interface IPublicPhotoItem extends IPublicPhotoBase {
  url: string;
}
