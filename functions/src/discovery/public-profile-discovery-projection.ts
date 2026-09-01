// functions/src/discovery/public-profile-discovery-projection.ts
// Comparações e projeções puras usadas pelo discovery público.
import { normalizePublicIdentityMediaUrl } from '../identity/public-media-url.normalizer';
import { normalizePublicProfileId } from '../identity/public-profile-id';
import type {
  CanonicalProfileDiscoveryFields,
} from './profile-discovery-normalization';

export interface PublicProfileIdProjection {
  /** Identificador social público opaco. Nunca é derivado do Firebase Auth UID. */
  profileId: string | null;
}

export interface PublicLocationProjection {
  latitude: number | null;
  longitude: number | null;
  geohash: string | null;
}

export interface PublicAvatarProjection {
  /** Campo canônico consumido pelas superfícies sociais. */
  avatarUrl: string | null;
  /** Alias temporário para consumidores legados durante a migração. */
  photoURL: string | null;
}

interface PublicLocationPolicy {
  decimals: number;
  geohashLen: number;
}

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

const PUBLIC_LOCATION_POLICIES: Record<string, PublicLocationPolicy> = {
  vip: { decimals: 5, geohashLen: 9 },
  premium: { decimals: 4, geohashLen: 8 },
  basic: { decimals: 3, geohashLen: 7 },
  free: { decimals: 2, geohashLen: 5 },
};

function sameStringArray(
  current: unknown,
  expected: readonly string[]
): boolean {
  if (!Array.isArray(current) || current.length !== expected.length) {
    return false;
  }

  return current.every((value, index) => value === expected[index]);
}

export function publicProfileDiscoveryProjectionMatches(
  current: Record<string, unknown>,
  expected: CanonicalProfileDiscoveryFields
): boolean {
  return (
    current['normalizedGender'] === expected.normalizedGender &&
    current['normalizedOrientation'] === expected.normalizedOrientation &&
    current['compatibilityReady'] === expected.compatibilityReady &&
    sameStringArray(
      current['interestedInGenders'],
      expected.interestedInGenders
    ) &&
    sameStringArray(
      current['interestedInOrientations'],
      expected.interestedInOrientations
    )
  );
}

/**
 * Projeta somente o identificador público já persistido no documento privado.
 * A ausência/inconsistência resulta em null: esta camada nunca fabrica profileId
 * e nunca usa UID como fallback, preservando a separação entre conta e identidade.
 */
export function buildPublicProfileIdProjection(
  user: Record<string, unknown>
): PublicProfileIdProjection {
  return {
    profileId: normalizePublicProfileId(user['profileId']),
  };
}

export function publicProfileIdProjectionMatches(
  current: Record<string, unknown>,
  expected: PublicProfileIdProjection
): boolean {
  return (current['profileId'] ?? null) === expected.profileId;
}

/**
 * Projeta a foto privada escolhida pelo próprio usuário para a identidade
 * pública. `avatarUrl` é o campo canônico; `photoURL` permanece como alias de
 * compatibilidade até todos os consumidores antigos migrarem.
 */
export function buildPublicAvatarProjection(
  user: Record<string, unknown>
): PublicAvatarProjection {
  const avatarUrl = normalizePublicIdentityMediaUrl(
    user['avatarUrl'] ?? user['photoURL']
  );

  return {
    avatarUrl,
    photoURL: avatarUrl,
  };
}

export function publicAvatarProjectionMatches(
  current: Record<string, unknown>,
  expected: PublicAvatarProjection
): boolean {
  return (
    (current['avatarUrl'] ?? null) === expected.avatarUrl &&
    (current['photoURL'] ?? null) === expected.photoURL
  );
}

/**
 * Projeta a posição privada de users/{uid} para public_profiles/{uid}.
 *
 * Esta é a fonte canônica da redução de precisão no backend. O cliente grava
 * apenas a posição privada; o trigger de discovery deriva a versão pública.
 */
export function buildPublicLocationProjection(
  user: Record<string, unknown>
): PublicLocationProjection {
  const latitude = toValidLatitude(user['latitude']);
  const longitude = toValidLongitude(user['longitude']);

  if (
    latitude === null ||
    longitude === null ||
    (latitude === 0 && longitude === 0)
  ) {
    return emptyPublicLocationProjection();
  }

  const policy = resolvePublicLocationPolicy(
    user['role'],
    user['emailVerified'] === true
  );
  const coarseLatitude = roundCoordinate(latitude, policy.decimals);
  const coarseLongitude = roundCoordinate(longitude, policy.decimals);

  return {
    latitude: coarseLatitude,
    longitude: coarseLongitude,
    geohash: encodeGeohash(
      coarseLatitude,
      coarseLongitude,
      policy.geohashLen
    ),
  };
}

export function publicLocationProjectionMatches(
  current: Record<string, unknown>,
  expected: PublicLocationProjection
): boolean {
  return (
    (current['latitude'] ?? null) === expected.latitude &&
    (current['longitude'] ?? null) === expected.longitude &&
    (current['geohash'] ?? null) === expected.geohash
  );
}

function emptyPublicLocationProjection(): PublicLocationProjection {
  return {
    latitude: null,
    longitude: null,
    geohash: null,
  };
}

function resolvePublicLocationPolicy(
  role: unknown,
  emailVerified: boolean
): PublicLocationPolicy {
  const normalizedRole = String(role ?? 'free').trim().toLowerCase();
  const base = PUBLIC_LOCATION_POLICIES[normalizedRole]
    ?? PUBLIC_LOCATION_POLICIES['free'];

  if (emailVerified) {
    return base;
  }

  return {
    decimals: Math.min(2, base.decimals),
    geohashLen: Math.min(5, base.geohashLen),
  };
}

function roundCoordinate(value: number, decimals: number): number {
  const safeDecimals = Math.max(0, Math.min(6, Math.trunc(decimals)));
  return Number(value.toFixed(safeDecimals));
}

function toValidLatitude(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= -90
    && value <= 90
    ? value
    : null;
}

function toValidLongitude(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= -180
    && value <= 180
    ? value
    : null;
}

/** Implementação padrão de geohash, sem dependência runtime adicional. */
function encodeGeohash(
  latitude: number,
  longitude: number,
  precision: number
): string {
  let latitudeMin = -90;
  let latitudeMax = 90;
  let longitudeMin = -180;
  let longitudeMax = 180;
  let evenBit = true;
  let bit = 0;
  let character = 0;
  let geohash = '';

  while (geohash.length < precision) {
    if (evenBit) {
      const midpoint = (longitudeMin + longitudeMax) / 2;
      if (longitude >= midpoint) {
        character = (character << 1) + 1;
        longitudeMin = midpoint;
      } else {
        character <<= 1;
        longitudeMax = midpoint;
      }
    } else {
      const midpoint = (latitudeMin + latitudeMax) / 2;
      if (latitude >= midpoint) {
        character = (character << 1) + 1;
        latitudeMin = midpoint;
      } else {
        character <<= 1;
        latitudeMax = midpoint;
      }
    }

    evenBit = !evenBit;
    bit += 1;

    if (bit === 5) {
      geohash += GEOHASH_BASE32[character];
      bit = 0;
      character = 0;
    }
  }

  return geohash;
}
