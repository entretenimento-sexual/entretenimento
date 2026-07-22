// src/app/core/interfaces/media/i-photo-publication-config.ts
// Estado/configuração de publicação da foto.
//
// IMPORTANTE:
// - este contrato NÃO representa o documento privado em users/{uid}/photos/{photoId}
// - ele representa a camada separada de publicação
// - isso evita misturar acervo privado com exposição pública
// - preparado para comentários, moderação, score, descoberta e monetização futura

export type TPhotoVisibility =
  | 'PRIVATE'
  | 'FRIENDS'
  | 'SUBSCRIBERS'
  | 'PREMIUM'
  | 'PUBLIC';

export type TPhotoCommentsPolicy =
  | 'OFF'
  | 'FRIENDS'
  | 'SUBSCRIBERS'
  | 'EVERYONE';

export type TPhotoModerationStatus =
  | 'PRIVATE'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'FLAGGED'
  | 'HIDDEN';

export interface IPhotoPublicationScore {
  /**
   * Score final usado para ordenação futura.
   * Deve ser calculado por backend/Cloud Function no futuro.
   */
  rankingScore: number;

  /**
   * Qualidade técnica/editorial da foto.
   * Ex: resolução, proporção, nitidez, completude do perfil.
   */
  qualityScore: number;

  /**
   * Engajamento controlado.
   * Ex: visualizações, comentários, reações, salvamentos.
   */
  engagementScore: number;

  /**
   * Segurança/moderação.
   * Denúncias, rejeições ou flags reduzem esse score.
   */
  safetyScore: number;
}

export interface IPhotoPublicationConfig {
  photoId: string;
  ownerUid: string;

  /**
   * Indica se a foto foi promovida da biblioteca privada para camada pública.
   */
  isPublished: boolean;

  /**
   * Define quem pode ver a foto publicada.
   *
   * PRIVATE: não aparece publicamente.
   * FRIENDS: apenas conexões/amigos.
   * SUBSCRIBERS: assinantes.
   * PREMIUM: conteúdo pago/exclusivo futuro.
   * PUBLIC: público conforme política da plataforma.
   */
  visibility: TPhotoVisibility;

  /** Legenda editorial da publicação, separada do texto alternativo da imagem. */
  caption?: string | null;

  isCover?: boolean;
  orderIndex?: number;

  /**
   * Comentários.
   *
   * commentsEnabled funciona como chave geral.
   * commentsPolicy define quem pode comentar quando habilitado.
   */
  commentsEnabled?: boolean;
  commentsPolicy?: TPhotoCommentsPolicy;
  commentsCount?: number;

  /**
   * Reações/likes/favoritos.
   */
  reactionsEnabled?: boolean;
  reactionsCount?: number;

  /**
   * Moderação.
   *
   * Para plataforma adulta, nenhuma foto deveria ganhar alcance real sem
   * passar por algum estado claro de moderação.
   */
  moderationStatus?: TPhotoModerationStatus;
  moderationReason?: string | null;
  reportsCount?: number;

  /**
   * Score resumido e score detalhado.
   *
   * score pode ser usado por UI simples.
   * scoreBreakdown prepara ranking e descoberta futura.
   */
  score?: number;
  scoreBreakdown?: IPhotoPublicationScore;

  publishedAt?: number | null;
  updatedAt?: number;
  lastModeratedAt?: number | null;
}
