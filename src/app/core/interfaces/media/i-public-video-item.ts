// src/app/core/interfaces/media/i-public-video-item.ts
// Contratos da projeção pública de vídeo e do item hidratado para exibição.
//
// Segurança:
// - a projeção Firestore não armazena URL permanente nem Storage path;
// - URLs de vídeo e poster são temporárias e emitidas pelo backend;
// - paths privados permanecem fora do contrato público.

import type {
  TPhotoModerationStatus,
  TPhotoVisibility,
} from './i-photo-publication-config';
import type { TPublicAssetAccess } from './i-public-photo-item';

export type TPublicVideoPosterAccess = 'SIGNED_URL' | 'NONE';

export interface IPublicVideoBase {
  id: string;
  ownerUid: string;

  mediaType: 'VIDEO';
  assetAccess: TPublicAssetAccess;
  posterAccess?: TPublicVideoPosterAccess;

  title?: string | null;
  alt?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationMs?: number | null;

  createdAt: number;
  publishedAt: number;
  updatedAt?: number;

  visibility: TPhotoVisibility;
  orderIndex: number;
  moderationStatus?: TPhotoModerationStatus;
  reportsCount?: number;

  viewsCount?: number;
  uniqueViewersCount?: number;
  lastViewedAt?: number;
  viewScore?: number;
  score?: number;

  ownerNickname?: string | null;
  ownerPhotoURL?: string | null;
  ownerGender?: string | null;
  ownerOrientation?: string | null;
  ownerMunicipio?: string | null;
  ownerEstado?: string | null;
}

/** Documento lido da projeção pública antes da autorização de acesso. */
export interface IPublicVideoProjection extends IPublicVideoBase {
  url?: string | null;
  posterUrl?: string | null;
}

/** Item pronto para renderização após receber URLs temporárias. */
export interface IPublicVideoItem extends IPublicVideoBase {
  url: string;
  posterUrl: string | null;
}
