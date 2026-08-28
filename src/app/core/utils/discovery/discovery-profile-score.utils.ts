// src/app/core/utils/discovery/discovery-profile-score.utils.ts
// -----------------------------------------------------------------------------
// DiscoveryProfileScoreUtils
// -----------------------------------------------------------------------------
// Score reutilizável para feeds de descoberta.
// -----------------------------------------------------------------------------
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

  compatibilityScore?: number | null;
  engagementScore?: number | null;
  mediaCount?: number | null;
  photosCount?: number | null;
  videosCount?: number | null;
  viewsCount?: number | null;
  likesCount?: number | null;
  profileCompletenessScore?: number | null;
}

export interface DiscoveryScoreContext {
  mode?: DiscoveryScoreMode;

  viewerUid?: string | null;

  viewerEstado?: string | null;
  viewerMunicipio?: string | null;

  nowMs?: number;

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

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
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
  const photosCount = normalizeCount(profile.photosCount);
  const videosCount = normalizeCount(profile.videosCount);
  const explicitMediaCount = normalizeCount(profile.mediaCount);
  const mediaCount = Math.max(explicitMediaCount, photosCount + videosCount);

  const photoBase = hasRealPhoto(profile.photoURL) ? 0.58 : 0;
  const photoBoost = clamp01(photosCount / 6) * 0.24;
  const videoBoost = clamp01(videosCount / 3) * 0.18;
  const mediaBoost = clamp01(mediaCount / 8) * 0.22;

  return clamp01(photoBase + photoBoost + videoBoost + mediaBoost);
}

function scoreDistance(
  profile: DiscoveryScoreProfileLike,
  context: DiscoveryScoreContext
): number {
  const distance = profile.distanciaKm;

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
  return normalizeOptionalScore(profile.compatibilityScore, 0.5);
}

function scoreEngagement(profile: DiscoveryScoreProfileLike): number {
  const explicit = normalizeOptionalScore(profile.engagementScore, Number.NaN);

  if (Number.isFinite(explicit)) {
    return explicit;
  }

  const views = normalizeCount(profile.viewsCount);
  const likes = normalizeCount(profile.likesCount);
  const media = Math.max(
    normalizeCount(profile.mediaCount),
    normalizeCount(profile.photosCount) + normalizeCount(profile.videosCount)
  );

  const viewScore = clamp01(Math.log10(views + 1) / 4);
  const likeScore = clamp01(Math.log10(likes + 1) / 3);
  const mediaScore = clamp01(media / 10);

  if (!views && !likes && !media) {
    return 0.5;
  }

  return clamp01(viewScore * 0.45 + likeScore * 0.35 + mediaScore * 0.2);
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
