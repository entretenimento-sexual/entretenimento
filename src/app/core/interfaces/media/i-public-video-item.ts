// src/app/core/interfaces/media/i-public-video-item.ts
// -----------------------------------------------------------------------------
// Contrato canônico de leitura para vídeos públicos.
//
// Segurança:
// - a projeção Firestore não expõe path privado nem URL permanente;
// - URLs temporárias são mantidas em um contrato de acesso separado;
// - somente vídeos PUBLIC + APPROVED entram no item consumido pelo player;
// - métricas legadas são normalizadas antes de chegar ao cache/NgRx.
// -----------------------------------------------------------------------------

export type TPublicVideoVisibility = 'PUBLIC';
export type TPublicVideoModerationStatus = 'APPROVED';
export type TPublicVideoAssetAccess = 'SIGNED_URL';
export type TPublicVideoPosterAccess = 'SIGNED_URL' | 'NONE';
export type TPublicVideoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

export interface IPublicVideoScoreBreakdown {
  readonly rankingScore: number;
  readonly qualityScore: number;
  readonly engagementScore: number;
  readonly safetyScore: number;
}

export interface IPublicVideoOwnerSummary {
  readonly nickname: string | null;
  readonly photoURL: string | null;
  readonly gender: string | null;
  readonly orientation: string | null;
  readonly municipio: string | null;
  readonly estado: string | null;
}

/**
 * Documento público normalizado e seguro para persistência em cache/NgRx.
 * Não contém URL assinada nem caminho de Storage.
 */
export interface IPublicVideoProjection {
  readonly id: string;
  readonly ownerUid: string;
  readonly mediaType: 'VIDEO';
  readonly assetAccess: TPublicVideoAssetAccess;
  readonly posterAccess: TPublicVideoPosterAccess;

  readonly title: string;
  readonly description: string | null;
  readonly alt: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationMs: number;

  readonly createdAt: number;
  readonly publishedAt: number;
  readonly updatedAt: number;
  readonly lastViewedAt: number | null;

  readonly visibility: TPublicVideoVisibility;
  readonly orderIndex: number;
  readonly moderationStatus: TPublicVideoModerationStatus;
  readonly moderationReason: string | null;

  readonly reactionsEnabled: boolean;
  readonly commentsEnabled: boolean;
  readonly ratingsEnabled: boolean;

  readonly viewsCount: number;
  readonly uniqueViewersCount: number;
  readonly reactionsCount: number;
  readonly commentsCount: number;
  readonly ratingsCount: number;
  readonly ratingAverage: number;

  readonly reportsCount: number;
  readonly openReportsCount: number;
  readonly confirmedReportsCount: number;

  readonly viewScore: number;
  readonly engagementScore: number;
  readonly score: number;
  readonly scoreBreakdown: IPublicVideoScoreBreakdown;

  /** Enriquecimento público opcional; não participa da identidade do vídeo. */
  readonly owner: IPublicVideoOwnerSummary | null;
}

/** URL temporária emitida pelo backend após nova validação de acesso. */
export interface IPublicVideoAccess {
  readonly ownerUid: string;
  readonly videoId: string;
  readonly url: string;
  readonly posterUrl: string | null;
  readonly expiresAt: number;
}

/** Item final usado pelo player público. */
export interface IPublicVideoItem extends IPublicVideoProjection {
  readonly url: string;
  readonly posterUrl: string | null;
  readonly accessExpiresAt: number;
}
