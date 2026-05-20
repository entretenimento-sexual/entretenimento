// src/app/core/utils/discovery/discovery-profile-score.utils.ts
// -----------------------------------------------------------------------------
// DiscoveryProfileScoreUtils
// -----------------------------------------------------------------------------
//
// Score reutilizável para feeds de descoberta.
//
// Responsabilidade:
// - calcular pontuação de ranking para perfis já elegíveis;
// - não consultar Firestore;
// - não decidir elegibilidade pública;
// - permitir pesos diferentes por modo de descoberta;
// - servir futuramente para Todos, Perto, Região, Recentes, Bombando,
//   Compatíveis e outros feeds nativos.
//
// Importante:
// - elegibilidade fica em discovery-profile-visibility.utils.ts;
// - score apenas ordena perfis que já podem aparecer.
export type DiscoveryScoreMode =
  | 'all'
  | 'online'
  | 'nearby'
  | 'region'
  | 'recent'
  | 'trending'
  | 'compatible';

export interface DiscoveryScoreProfileLike {
  uid?: string | null;

  nickname?: string | null;
  photoURL?: string | null;

  gender?: string | null;
  orientation?: string | null;

  estado?: string | null;
  municipio?: string | null;

  role?: string | null;
  tier?: string | null;

  distanciaKm?: number | null;

  isOnline?: boolean | null;

  createdAt?: unknown;
  updatedAt?: unknown;
  lastSeen?: unknown;
  lastOnlineAt?: unknown;

  /**
   * Campos futuros opcionais.
   * Se ainda não existirem, não quebram o score.
   */
  compatibilityScore?: number | null; // 0..1 ou 0..100
  engagementScore?: number | null; // curtidas, visitas, interações futuras
  mediaCount?: number | null;
  photosCount?: number | null;
  profileCompletenessScore?: number | null; // 0..1 ou 0..100
}

export interface DiscoveryScoreContext {
  mode?: DiscoveryScoreMode;

  viewerUid?: string | null;

  viewerEstado?: string | null;
  viewerMunicipio?: string | null;

  nowMs?: number;

  /**
   * Distância de referência para decaimento.
   * No modo Todos, distância ajuda, mas não deve eliminar.
   */
  maxUsefulDistanceKm?: number;
}

export interface DiscoveryScoreWeights {
  quality: number;
  media: number;
  distance: number;
  region: number;
  recency: number;
  role: number;
  online: number;
  compatibility: number;
  engagement: number;
  tieBreaker: number;
}

export interface DiscoveryScoreBreakdown {
  total: number;

  quality: number;
  media: number;
  distance: number;
  region: number;
  recency: number;
  role: number;
  online: number;
  compatibility: number;
  engagement: number;
  tieBreaker: number;

  mode: DiscoveryScoreMode;
}

export interface ScoredDiscoveryProfile<T extends DiscoveryScoreProfileLike> {
  profile: T;
  score: DiscoveryScoreBreakdown;
}

export const DISCOVERY_SCORE_PRESETS: Record<
  DiscoveryScoreMode,
  DiscoveryScoreWeights
> = {
  all: {
    quality: 18,
    media: 14,
    distance: 14,
    region: 12,
    recency: 14,
    role: 8,
    online: 6,
    compatibility: 10,
    engagement: 6,
    tieBreaker: 0.1,
  },

  online: {
    quality: 16,
    media: 12,
    distance: 12,
    region: 10,
    recency: 12,
    role: 6,
    online: 24,
    compatibility: 10,
    engagement: 6,
    tieBreaker: 0.1,
  },

  nearby: {
    quality: 12,
    media: 10,
    distance: 34,
    region: 16,
    recency: 8,
    role: 5,
    online: 6,
    compatibility: 8,
    engagement: 4,
    tieBreaker: 0.1,
  },

  region: {
    quality: 14,
    media: 10,
    distance: 10,
    region: 32,
    recency: 10,
    role: 5,
    online: 6,
    compatibility: 8,
    engagement: 4,
    tieBreaker: 0.1,
  },

  recent: {
    quality: 14,
    media: 10,
    distance: 8,
    region: 8,
    recency: 34,
    role: 5,
    online: 8,
    compatibility: 8,
    engagement: 4,
    tieBreaker: 0.1,
  },

  trending: {
    quality: 12,
    media: 12,
    distance: 6,
    region: 6,
    recency: 12,
    role: 5,
    online: 8,
    compatibility: 8,
    engagement: 30,
    tieBreaker: 0.1,
  },

  compatible: {
    quality: 12,
    media: 10,
    distance: 8,
    region: 8,
    recency: 8,
    role: 4,
    online: 6,
    compatibility: 40,
    engagement: 4,
    tieBreaker: 0.1,
  },
};

const ROLE_SCORE: Record<string, number> = {
  vip: 1,
  premium: 0.86,
  basic: 0.68,
  free: 0.42,
  visitante: 0.2,
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasRealPhoto(photoURL: unknown): boolean {
  if (!hasText(photoURL)) {
    return false;
  }

  const value = normalizeText(photoURL);

  return !value.includes('imagem-padrao') &&
    !value.includes('default') &&
    !value.includes('placeholder');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeOptionalScore(
  value: unknown,
  neutral = 0.5
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return neutral;
  }

  if (value > 1) {
    return clamp01(value / 100);
  }

  return clamp01(value);
}

function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof value === 'string') {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  const maybeTimestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
  } | null | undefined;

  if (typeof maybeTimestamp?.toMillis === 'function') {
    const time = maybeTimestamp.toMillis();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof maybeTimestamp?.toDate === 'function') {
    const time = maybeTimestamp.toDate().getTime();
    return Number.isFinite(time) ? time : 0;
  }

  return 0;
}

function scoreQuality(profile: DiscoveryScoreProfileLike): number {
  const explicit = normalizeOptionalScore(
    profile.profileCompletenessScore,
    Number.NaN
  );

  if (Number.isFinite(explicit)) {
    return explicit;
  }

  let points = 0;
  let max = 0;

  const add = (condition: boolean, weight: number) => {
    max += weight;
    if (condition) {
      points += weight;
    }
  };

  add(hasText(profile.uid), 2);
  add(hasText(profile.nickname), 3);
  add(hasText(profile.gender), 2);
  add(hasText(profile.orientation), 2);
  add(hasText(profile.estado), 2);
  add(hasText(profile.municipio), 2);
  add(hasRealPhoto(profile.photoURL), 4);

  return max ? points / max : 0;
}

function scoreMedia(profile: DiscoveryScoreProfileLike): number {
  const mediaCount =
    typeof profile.mediaCount === 'number'
      ? profile.mediaCount
      : typeof profile.photosCount === 'number'
        ? profile.photosCount
        : null;

  const photoBase = hasRealPhoto(profile.photoURL) ? 0.72 : 0;

  if (mediaCount === null || !Number.isFinite(mediaCount)) {
    return photoBase;
  }

  const mediaBoost = clamp01(mediaCount / 6) * 0.28;

  return clamp01(photoBase + mediaBoost);
}

function scoreDistance(
  profile: DiscoveryScoreProfileLike,
  context: DiscoveryScoreContext
): number {
  const distance = profile.distanciaKm;

  /**
   * No "Todos", ausência de distância é neutra-baixa, não eliminação.
   * Isso evita punir perfis válidos quando localização não estiver disponível.
   */
  if (typeof distance !== 'number' || !Number.isFinite(distance)) {
    return 0.45;
  }

  if (distance <= 1) {
    return 1;
  }

  const max = context.maxUsefulDistanceKm ?? 80;

  if (distance >= max) {
    return 0.08;
  }

  return clamp01(1 - distance / max);
}

function scoreRegion(
  profile: DiscoveryScoreProfileLike,
  context: DiscoveryScoreContext
): number {
  const viewerMunicipio = normalizeText(context.viewerMunicipio);
  const viewerEstado = normalizeText(context.viewerEstado);

  const profileMunicipio = normalizeText(profile.municipio);
  const profileEstado = normalizeText(profile.estado);

  if (viewerMunicipio && profileMunicipio && viewerMunicipio === profileMunicipio) {
    return 1;
  }

  if (viewerEstado && profileEstado && viewerEstado === profileEstado) {
    return 0.65;
  }

  if (profileEstado || profileMunicipio) {
    return 0.32;
  }

  return 0.12;
}

function scoreRecency(
  profile: DiscoveryScoreProfileLike,
  context: DiscoveryScoreContext
): number {
  const now = context.nowMs ?? Date.now();

  const last = Math.max(
    toMillis(profile.lastOnlineAt),
    toMillis(profile.lastSeen),
    toMillis(profile.updatedAt),
    toMillis(profile.createdAt)
  );

  if (!last) {
    return 0.25;
  }

  const ageDays = Math.max(
    0,
    (now - last) / (1000 * 60 * 60 * 24)
  );

  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.82;
  if (ageDays <= 30) return 0.58;
  if (ageDays <= 90) return 0.32;

  return 0.12;
}

function scoreRole(profile: DiscoveryScoreProfileLike): number {
  const role = normalizeText(profile.role || profile.tier || 'free');

  return ROLE_SCORE[role] ?? ROLE_SCORE['free'];
}

function scoreOnline(profile: DiscoveryScoreProfileLike): number {
  return profile.isOnline === true ? 1 : 0;
}

function scoreCompatibility(profile: DiscoveryScoreProfileLike): number {
  /**
   * Compatibilidade ainda é futura.
   * Quando existir, pode vir como 0..1 ou 0..100.
   * Sem dado, retorna neutro.
   */
  return normalizeOptionalScore(profile.compatibilityScore, 0.5);
}

function scoreEngagement(profile: DiscoveryScoreProfileLike): number {
  /**
   * Engajamento ainda é futuro.
   * Exemplo futuro:
   * - visitas recentes;
   * - curtidas;
   * - respostas;
   * - fotos publicadas;
   * - perfil favoritado.
   *
   * Sem dado, retorna neutro.
   */
  return normalizeOptionalScore(profile.engagementScore, 0.5);
}

function stableUidTieBreaker(uid: string | null | undefined): number {
  const value = uid || '';

  if (!value) {
    return 0;
  }

  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return (hash % 1000) / 1000;
}

export function getDiscoveryScoreWeights(
  mode: DiscoveryScoreMode = 'all'
): DiscoveryScoreWeights {
  return DISCOVERY_SCORE_PRESETS[mode] ?? DISCOVERY_SCORE_PRESETS.all;
}

export function scoreDiscoveryProfile<T extends DiscoveryScoreProfileLike>(
  profile: T,
  context: DiscoveryScoreContext = {},
  weights: DiscoveryScoreWeights = getDiscoveryScoreWeights(context.mode ?? 'all')
): DiscoveryScoreBreakdown {
  const mode = context.mode ?? 'all';

  const qualityRaw = scoreQuality(profile);
  const mediaRaw = scoreMedia(profile);
  const distanceRaw = scoreDistance(profile, context);
  const regionRaw = scoreRegion(profile, context);
  const recencyRaw = scoreRecency(profile, context);
  const roleRaw = scoreRole(profile);
  const onlineRaw = scoreOnline(profile);
  const compatibilityRaw = scoreCompatibility(profile);
  const engagementRaw = scoreEngagement(profile);
  const tieBreakerRaw = stableUidTieBreaker(profile.uid);

  const breakdown: DiscoveryScoreBreakdown = {
    mode,

    quality: qualityRaw * weights.quality,
    media: mediaRaw * weights.media,
    distance: distanceRaw * weights.distance,
    region: regionRaw * weights.region,
    recency: recencyRaw * weights.recency,
    role: roleRaw * weights.role,
    online: onlineRaw * weights.online,
    compatibility: compatibilityRaw * weights.compatibility,
    engagement: engagementRaw * weights.engagement,
    tieBreaker: tieBreakerRaw * weights.tieBreaker,

    total: 0,
  };

  breakdown.total =
    breakdown.quality +
    breakdown.media +
    breakdown.distance +
    breakdown.region +
    breakdown.recency +
    breakdown.role +
    breakdown.online +
    breakdown.compatibility +
    breakdown.engagement +
    breakdown.tieBreaker;

  return breakdown;
}

export function scoreDiscoveryProfiles<T extends DiscoveryScoreProfileLike>(
  profiles: readonly T[],
  context: DiscoveryScoreContext = {},
  weights?: DiscoveryScoreWeights
): ScoredDiscoveryProfile<T>[] {
  const resolvedWeights =
    weights ?? getDiscoveryScoreWeights(context.mode ?? 'all');

  return profiles.map((profile) => ({
    profile,
    score: scoreDiscoveryProfile(profile, context, resolvedWeights),
  }));
}

export function sortDiscoveryProfilesByScore<T extends DiscoveryScoreProfileLike>(
  profiles: readonly T[],
  context: DiscoveryScoreContext = {},
  weights?: DiscoveryScoreWeights
): T[] {
  return scoreDiscoveryProfiles(profiles, context, weights)
    .sort((a, b) => {
      if (b.score.total !== a.score.total) {
        return b.score.total - a.score.total;
      }

      return String(a.profile.nickname || '').localeCompare(
        String(b.profile.nickname || ''),
        'pt-BR',
        { sensitivity: 'base' }
      );
    })
    .map((item) => item.profile);
}