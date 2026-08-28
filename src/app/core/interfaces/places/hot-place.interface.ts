// src/app/core/interfaces/places/hot-place.interface.ts
// -----------------------------------------------------------------------------
// Contratos de domínio para "Locais bombando".
// -----------------------------------------------------------------------------
// Objetivo:
// - representar locais/ambientes regionais com alta atividade;
// - permitir exibição regional sem expor dados sensíveis de usuários;
// - preparar integração futura com compatibilidade, rooms e moderação;
// - manter o frontend desacoplado da forma como o score é calculado no backend.
//
// Segurança:
// - este contrato NÃO deve carregar lista de participantes, UIDs ou coordenadas
//   precisas de usuários;
// - o dado ideal para leitura pública/regional deve ser uma projeção agregada;
// - documentos devem ser moderáveis e removíveis da vitrine sem apagar histórico;
// - sinais de afinidade devem ser exibidos apenas como agrupamento agregado,
//   com piso mínimo de anonimização e sem identificar indivíduos.

export type HotPlaceKind =
  | 'city_area'
  | 'venue'
  | 'event'
  | 'room_cluster'
  | 'online_pulse';

export type HotPlaceAudience =
  | 'all'
  | 'singles'
  | 'couples'
  | 'verified'
  | 'subscribers';

export type HotPlaceVisibility = 'visible' | 'hidden' | 'moderation_hold';

export type HotPlaceCompatibilitySignal =
  | 'same_city'
  | 'same_state'
  | 'available_now'
  | 'intent_overlap'
  | 'practice_overlap'
  | 'verified_only'
  | 'subscriber_boost';

export type HotPlaceAffinitySegment =
  | 'h_m'
  | 'm_h'
  | 'h_h'
  | 'm_m'
  | 'casais'
  | 'casais_solos'
  | 'misto'
  | 'lgbtq'
  | 'bi'
  | 'aberto';

export interface IHotPlaceRegion {
  /** UF em formato canônico: RJ, SP, MG etc. */
  uf: string;

  /** Município normalizado em minúsculas, seguindo padrão atual do projeto. */
  city: string;
}

export interface IHotPlaceMetrics {
  /** Score agregado calculado fora da UI. Quanto maior, mais relevante. */
  score: number;

  /** Sinal agregado de atividade recente, sem identificar usuários. */
  activeNowCount?: number | null;

  /** Quantidade agregada de salas/conversas relacionadas, se houver. */
  roomCount?: number | null;

  /** Quantidade agregada de perfis compatíveis, se houver. */
  compatibleProfileCount?: number | null;

  /** Timestamp epoch ms da última atividade agregada. */
  lastActivityAt?: number | null;
}

export interface IHotPlaceModeration {
  visibility: HotPlaceVisibility;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  reason?: string | null;
}

export interface IHotPlaceAffinityMix {
  /** Piso mínimo aplicado antes de exibir qualquer segmento agregado. */
  sampleFloor: number;

  /** Segmentos predominantes já agregados e seguros para exibição. */
  primarySegments: HotPlaceAffinitySegment[];

  /** Segmentos secundários, também agregados. */
  secondarySegments?: HotPlaceAffinitySegment[] | null;

  /** Selo operacional para a UI. Nunca deve conter texto livre de usuário. */
  confidence: 'low' | 'medium' | 'high';

  /** Quando a projeção foi gerada. */
  generatedAt?: number | null;
}

export interface IHotPlace {
  id: string;
  title: string;
  subtitle?: string | null;
  kind: HotPlaceKind;
  audience: HotPlaceAudience;
  region: IHotPlaceRegion;
  metrics: IHotPlaceMetrics;
  moderation: IHotPlaceModeration;
  compatibilitySignals: HotPlaceCompatibilitySignal[];
  affinityMix?: IHotPlaceAffinityMix | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface IHotPlaceCardVm extends IHotPlace {
  scoreLabel: string;
  activityLabel: string;
  regionLabel: string;
  affinitySummaryLabel: string | null;
  affinitySegmentLabels: string[];
  isVisible: boolean;
}

export interface IHotPlaceQueryOptions {
  limit?: number;
  minimumScore?: number;
  audience?: HotPlaceAudience | 'any';
}
