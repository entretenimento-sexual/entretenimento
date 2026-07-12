// src/app/dashboard/discovery/data-access/public-profile-card.mapper.ts
// -----------------------------------------------------------------------------
// Mapper puro da projeção public_profiles -> PublicProfileCard.
//
// Objetivos:
// - normalizar aliases legados em uma única borda;
// - impedir Timestamp/Date dentro do NgRx;
// - manter somente campos públicos e seguros;
// - evitar que componentes e facades repitam regras de leitura.
// -----------------------------------------------------------------------------

import { PublicProfileCard } from '../models/public-profile-card.model';

type PublicProfileSource = Record<string, unknown>;

function asRecord(value: unknown): PublicProfileSource {
  return typeof value === 'object' && value !== null
    ? (value as PublicProfileSource)
    : {};
}

function firstValue(
  source: PublicProfileSource,
  keys: readonly string[]
): unknown {
  for (const key of keys) {
    const value = source[key];

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function firstText(
  source: PublicProfileSource,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = source[key];

    if (typeof value !== 'string') {
      continue;
    }

    const text = value.trim();

    if (text) {
      return text;
    }
  }

  return null;
}

function firstNumber(
  source: PublicProfileSource,
  keys: readonly string[]
): number | null {
  const value = firstValue(source, keys);
  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function firstCoordinate(
  source: PublicProfileSource,
  keys: readonly string[],
  min: number,
  max: number
): number | null {
  const value = firstValue(source, keys);
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function firstStringArray(
  source: PublicProfileSource,
  keys: readonly string[]
): readonly string[] | null {
  for (const key of keys) {
    const value = source[key];

    if (!Array.isArray(value)) {
      continue;
    }

    const items = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);

    if (items.length) {
      return Array.from(new Set(items));
    }
  }

  return null;
}

function firstPreferenceValue(
  source: PublicProfileSource,
  keys: readonly string[]
): readonly string[] | string | null {
  const arrayValue = firstStringArray(source, keys);

  if (arrayValue?.length) {
    return arrayValue;
  }

  return firstText(source, keys);
}

export function toSerializableEpoch(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (value instanceof Date) {
    const epoch = value.getTime();
    return Number.isFinite(epoch) && epoch > 0 ? Math.trunc(epoch) : null;
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const timestampLike = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: unknown;
    nanoseconds?: unknown;
  };

  if (typeof timestampLike.toMillis === 'function') {
    try {
      const epoch = timestampLike.toMillis();
      return Number.isFinite(epoch) && epoch > 0 ? Math.trunc(epoch) : null;
    } catch {
      return null;
    }
  }

  if (typeof timestampLike.toDate === 'function') {
    try {
      const epoch = timestampLike.toDate().getTime();
      return Number.isFinite(epoch) && epoch > 0 ? Math.trunc(epoch) : null;
    } catch {
      return null;
    }
  }

  if (typeof timestampLike.seconds === 'number') {
    const seconds = timestampLike.seconds;
    const nanos =
      typeof timestampLike.nanoseconds === 'number'
        ? timestampLike.nanoseconds
        : 0;
    const epoch = seconds * 1000 + Math.trunc(nanos / 1_000_000);

    return Number.isFinite(epoch) && epoch > 0 ? Math.trunc(epoch) : null;
  }

  return null;
}

export function mapPublicProfileCard(
  raw: unknown,
  fallbackUid?: string | null
): PublicProfileCard | null {
  const source = asRecord(raw);
  const uid =
    firstText(source, ['uid', 'id']) ?? String(fallbackUid ?? '').trim();
  const nickname = firstText(source, ['nickname']);

  if (!uid || !nickname) {
    return null;
  }

  const likesCount = firstNumber(source, [
    'likesCount',
    'publicLikesCount',
    'reactionsCount',
  ]);
  const reactionsCount =
    firstNumber(source, ['reactionsCount']) ?? likesCount;
  const profileUniqueViewersCount = firstNumber(source, [
    'profileUniqueViewersCount',
    'uniqueViewersCount',
  ]);

  return {
    uid,
    nickname,
    nicknameNormalized:
      firstText(source, ['nicknameNormalized']) ?? nickname.toLowerCase(),

    photoURL: firstText(source, [
      'photoURL',
      'photoUrl',
      'avatarUrl',
      'avatarURL',
    ]),

    gender: firstText(source, ['gender', 'genero']),
    orientation: firstText(source, [
      'orientation',
      'sexualOrientation',
      'orientacao',
      'orientacaoSexual',
    ]),

    normalizedGender: firstText(source, ['normalizedGender']),
    normalizedOrientation: firstText(source, ['normalizedOrientation']),
    compatibilityReady:
      typeof source['compatibilityReady'] === 'boolean'
        ? source['compatibilityReady']
        : null,

    partner1Orientation: firstText(source, [
      'partner1Orientation',
      'orientation1',
      'orientacaoParceiro1',
    ]),
    partner2Orientation: firstText(source, [
      'partner2Orientation',
      'orientation2',
      'orientacaoParceiro2',
    ]),

    preferences: firstPreferenceValue(source, [
      'preferences',
      'preferencias',
      'interests',
      'interesses',
      'lookingFor',
      'buscando',
    ]),
    interestedInGenders: firstPreferenceValue(source, [
      'interestedInGenders',
      'interestedInGender',
      'targetGenders',
      'preferredGenders',
      'generosDeInteresse',
    ]),
    interestedInOrientations: firstPreferenceValue(source, [
      'interestedInOrientations',
      'interestedInOrientation',
      'targetOrientations',
      'preferredOrientations',
      'orientacoesDeInteresse',
    ]),

    municipio: firstText(source, ['municipio', 'cidade', 'city']),
    estado: firstText(source, ['estado', 'uf', 'state']),
    role: firstText(source, ['role']) ?? 'free',

    latitude: firstCoordinate(source, ['latitude', 'lat'], -90, 90),
    longitude: firstCoordinate(
      source,
      ['longitude', 'lng', 'lon'],
      -180,
      180
    ),
    geohash: firstText(source, ['geohash']),

    isOnline: source['isOnline'] === true,
    lastSeen: toSerializableEpoch(firstValue(source, ['lastSeen'])),
    lastOnlineAt: toSerializableEpoch(firstValue(source, ['lastOnlineAt'])),
    lastOfflineAt: toSerializableEpoch(firstValue(source, ['lastOfflineAt'])),

    createdAt: toSerializableEpoch(firstValue(source, ['createdAt'])),
    updatedAt: toSerializableEpoch(firstValue(source, ['updatedAt'])),

    mediaCount: firstNumber(source, ['mediaCount', 'publicMediaCount']),
    photosCount: firstNumber(source, ['photosCount', 'publicPhotosCount']),
    videosCount: firstNumber(source, ['videosCount', 'publicVideosCount']),
    viewsCount: firstNumber(source, [
      'viewsCount',
      'profileViewsCount',
      'profileViews',
    ]),
    profileUniqueViewersCount,
    uniqueViewersCount: profileUniqueViewersCount,
    mediaUniqueViewersCount: firstNumber(source, [
      'mediaUniqueViewersCount',
    ]),
    likesCount,
    reactionsCount,
    viewScore: firstNumber(source, ['viewScore']),
    engagementScore: firstNumber(source, ['engagementScore']),
    profileCompletenessScore: firstNumber(source, [
      'profileCompletenessScore',
    ]),
    mediaMetricsUpdatedAt: toSerializableEpoch(
      firstValue(source, ['mediaMetricsUpdatedAt'])
    ),
  };
}
