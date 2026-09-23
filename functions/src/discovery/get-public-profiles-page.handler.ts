// functions/src/discovery/get-public-profiles-page.handler.ts
// -----------------------------------------------------------------------------
// DISCOVERY PUBLIC PROFILES READ BOUNDARY
// -----------------------------------------------------------------------------
// Todas as listagens/hidratações públicas passam por uma fronteira backend-time.
// A passagem do relógio invalida a exposição mesmo que a projeção materializada
// ainda não tenha sido atualizada pela Cloud Task de expiração.
// -----------------------------------------------------------------------------

import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';

type DiscoveryMode = 'all' | 'compatible';

interface DiscoveryCursor {
  updatedAtMs?: unknown;
  uid?: unknown;
}

interface DiscoveryFiltersInput {
  gender?: unknown;
  orientation?: unknown;
  municipio?: unknown;
  estado?: unknown;
  nicknamePrefix?: unknown;
}

interface DiscoveryNearbyInput {
  latitude?: unknown;
  longitude?: unknown;
  maxDistanceKm?: unknown;
  bounds?: unknown;
}

interface DiscoveryPageRequest {
  mode?: unknown;
  pageSize?: unknown;
  cursor?: DiscoveryCursor | null;
  uids?: unknown;
  filters?: DiscoveryFiltersInput | null;
  nearby?: DiscoveryNearbyInput | null;
}

interface DiscoveryPageCursor {
  updatedAtMs: number;
  uid: string;
}

interface DiscoveryFilters {
  gender: string | null;
  orientation: string | null;
  municipio: string | null;
  estado: string | null;
  nicknamePrefix: string | null;
}

interface DiscoveryNearbyBound {
  start: string;
  end: string;
}

interface DiscoveryNearby {
  latitude: number;
  longitude: number;
  maxDistanceKm: number;
  bounds: DiscoveryNearbyBound[];
}

interface DiscoveryPageResponse {
  items: Record<string, unknown>[];
  nextCursor: DiscoveryPageCursor | null;
  reachedEnd: boolean;
  fetchedAt: number;
  scanned: number;
}

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 120;
const MAX_SCAN_MULTIPLIER = 4;
const MAX_SCAN_ABSOLUTE = 480;
const MAX_UIDS_PER_REQUEST = 50;
const MAX_NEARBY_BOUNDS = 12;

const DISCOVERY_READ_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 20,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 100,
});

export function discoveryReadRateLimitCost(input: {
  pageSize?: number;
  uidCount?: number;
}): number {
  const uidCount = Number(input.uidCount ?? 0);
  if (Number.isFinite(uidCount) && uidCount > 0) {
    return Math.max(1, Math.ceil(uidCount / 25));
  }

  const pageSize = Number(input.pageSize ?? 24);
  return Math.max(
    1,
    Math.ceil((Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 24) / 24)
  );
}

function cleanUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

function positiveEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function timestampToMillis(value: unknown): number | null {
  const direct = positiveEpoch(value);
  if (direct !== null) return direct;

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return positiveEpoch((value as { toMillis: () => number }).toMillis());
  }

  return null;
}

function normalizePageSize(value: unknown): number {
  const parsed = Number(value);
  const pageSize = Number.isFinite(parsed) ? Math.trunc(parsed) : 24;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, pageSize));
}

function normalizeMode(value: unknown): DiscoveryMode {
  return value === 'compatible' ? 'compatible' : 'all';
}

function normalizeCursor(value: unknown): DiscoveryPageCursor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const uid = cleanUid(raw['uid']);
  const updatedAtMs = positiveEpoch(raw['updatedAtMs']);

  return uid && updatedAtMs ? { uid, updatedAtMs } : null;
}

function normalizeUidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => cleanUid(item))
        .filter(Boolean)
    )
  ).slice(0, MAX_UIDS_PER_REQUEST);
}


function normalizeNearby(value: unknown): DiscoveryNearby | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const latitude = Number(raw['latitude']);
  const longitude = Number(raw['longitude']);
  const maxDistanceKm = Number(raw['maxDistanceKm']);
  const rawBounds = Array.isArray(raw['bounds']) ? raw['bounds'] : [];

  if (
    !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || !Number.isFinite(maxDistanceKm)
    || maxDistanceKm < 1
    || maxDistanceKm > 500
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Parâmetros de proximidade inválidos.'
    );
  }

  const bounds = rawBounds
    .slice(0, MAX_NEARBY_BOUNDS)
    .map((item): DiscoveryNearbyBound | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }

      const bound = item as Record<string, unknown>;
      const start = String(bound['start'] ?? '').trim();
      const end = String(bound['end'] ?? '').trim();

      return start && end && start <= end
        ? { start, end }
        : null;
    })
    .filter((bound): bound is DiscoveryNearbyBound => bound !== null);

  if (!bounds.length) {
    throw new HttpsError(
      'invalid-argument',
      'Intervalos de geohash inválidos.'
    );
  }

  return {
    latitude,
    longitude,
    maxDistanceKm,
    bounds,
  };
}

function distanceKmBetween(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusKm = 6371.0088;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const latA = toRadians(latitudeA);
  const latB = toRadians(latitudeB);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latA)
      * Math.cos(latB)
      * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
}

function normalizedComparableText(value: unknown): string | null {
  const text = cleanText(value);
  return text ? text.toLocaleLowerCase('pt-BR') : null;
}

function normalizeFilters(value: unknown): DiscoveryFilters {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  return {
    gender: normalizedComparableText(raw['gender']),
    orientation: normalizedComparableText(raw['orientation']),
    municipio: normalizedComparableText(raw['municipio']),
    estado: normalizedComparableText(raw['estado']),
    nicknamePrefix: normalizedComparableText(raw['nicknamePrefix']),
  };
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const result = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

  return result.length ? result : null;
}

export function isCurrentPublicProfileAgeProjection(
  data: Record<string, unknown>,
  nowMs: number
): boolean {
  const validUntilMs = timestampToMillis(data['ageEligibilityValidUntil']);

  return data['ageEligibilityAdultAccessAllowed'] === true
    && validUntilMs !== null
    && validUntilMs > nowMs;
}

function matchesDiscoveryFilters(
  card: Record<string, unknown>,
  filters: DiscoveryFilters
): boolean {
  return (
    (!filters.gender
      || normalizedComparableText(card['gender']) === filters.gender)
    && (!filters.orientation
      || normalizedComparableText(card['orientation']) === filters.orientation)
    && (!filters.municipio
      || normalizedComparableText(card['municipio']) === filters.municipio)
    && (!filters.estado
      || normalizedComparableText(card['estado']) === filters.estado)
    && (!filters.nicknamePrefix
      || String(card['nicknameNormalized'] ?? '')
        .toLocaleLowerCase('pt-BR')
        .startsWith(filters.nicknamePrefix))
  );
}

export function serializePublicProfileForDiscovery(
  uid: string,
  data: Record<string, unknown>,
  nowMs: number
): Record<string, unknown> | null {
  const nickname = cleanText(data['nickname']);

  if (
    !uid
    || !nickname
    || !isCurrentPublicProfileAgeProjection(data, nowMs)
  ) {
    return null;
  }

  const validUntilMs = timestampToMillis(data['ageEligibilityValidUntil']);
  const latitude = finiteNumber(data['latitude']);
  const longitude = finiteNumber(data['longitude']);
  const coordinatesValid =
    latitude !== null
    && longitude !== null
    && !(latitude === 0 && longitude === 0);

  return {
    uid,
    profileId: cleanText(data['profileId']),
    nickname,
    nicknameNormalized:
      cleanText(data['nicknameNormalized']) ?? nickname.toLowerCase(),
    photoURL: cleanText(data['photoURL'] ?? data['avatarUrl']),
    gender: cleanText(data['gender']),
    identityCode: cleanText(data['identityCode']),
    identityCatalogVersion: finiteNumber(data['identityCatalogVersion']),
    identityLabel: cleanText(data['identityLabel']),
    identityShortLabel: cleanText(data['identityShortLabel']),
    identityDiscoveryGroup: cleanText(data['identityDiscoveryGroup']),
    orientation: cleanText(data['orientation']),
    age: null,
    normalizedGender: cleanText(data['normalizedGender']),
    normalizedOrientation: cleanText(data['normalizedOrientation']),
    compatibilityReady:
      typeof data['compatibilityReady'] === 'boolean'
        ? data['compatibilityReady']
        : null,
    partner1Orientation: cleanText(data['partner1Orientation']),
    partner2Orientation: cleanText(data['partner2Orientation']),
    preferences:
      cleanStringArray(data['preferences']) ?? cleanText(data['preferences']),
    interestedInGenders:
      cleanStringArray(data['interestedInGenders'])
      ?? cleanText(data['interestedInGenders']),
    interestedInOrientations:
      cleanStringArray(data['interestedInOrientations'])
      ?? cleanText(data['interestedInOrientations']),
    publicRelationshipIntents:
      cleanStringArray(data['publicRelationshipIntents']),
    publicSexualPractices:
      cleanStringArray(data['publicSexualPractices']),
    publicBodyTraits: cleanStringArray(data['publicBodyTraits']),
    preferenceBadgesVisible:
      typeof data['preferenceBadgesVisible'] === 'boolean'
        ? data['preferenceBadgesVisible']
        : null,
    publicPreferencesUpdatedAt:
      timestampToMillis(data['publicPreferencesUpdatedAt']),
    municipio: cleanText(data['municipio']),
    estado: cleanText(data['estado']),
    role: cleanText(data['role']) ?? 'free',
    latitude: coordinatesValid ? latitude : null,
    longitude: coordinatesValid ? longitude : null,
    geohash: coordinatesValid ? cleanText(data['geohash']) : null,
    hideFromDiscovery: data['hideFromDiscovery'] === true,
    hideFromOnline: data['hideFromOnline'] === true,
    isOnline: data['isOnline'] === true,
    lastSeen: timestampToMillis(data['lastSeen']),
    lastOnlineAt: timestampToMillis(data['lastOnlineAt']),
    lastOfflineAt: timestampToMillis(data['lastOfflineAt']),
    createdAt: timestampToMillis(data['createdAt']),
    updatedAt: timestampToMillis(data['updatedAt']),
    mediaCount:
      finiteNumber(data['mediaCount'] ?? data['publicMediaCount']),
    photosCount:
      finiteNumber(data['photosCount'] ?? data['publicPhotosCount']),
    videosCount:
      finiteNumber(data['videosCount'] ?? data['publicVideosCount']),
    viewsCount:
      finiteNumber(data['viewsCount'] ?? data['profileViewsCount']),
    profileUniqueViewersCount:
      finiteNumber(
        data['profileUniqueViewersCount'] ?? data['uniqueViewersCount']
      ),
    uniqueViewersCount:
      finiteNumber(
        data['profileUniqueViewersCount'] ?? data['uniqueViewersCount']
      ),
    mediaUniqueViewersCount:
      finiteNumber(data['mediaUniqueViewersCount']),
    likesCount:
      finiteNumber(data['likesCount'] ?? data['publicLikesCount']),
    reactionsCount:
      finiteNumber(data['reactionsCount'])
      ?? finiteNumber(data['likesCount'] ?? data['publicLikesCount']),
    viewScore: finiteNumber(data['viewScore']),
    engagementScore: finiteNumber(data['engagementScore']),
    profileCompletenessScore:
      finiteNumber(data['profileCompletenessScore']),
    mediaMetricsUpdatedAt:
      timestampToMillis(data['mediaMetricsUpdatedAt']),
    ageEligibilityAdultAccessAllowed: true,
    ageEligibilityValidUntil: validUntilMs,
  };
}

async function getNearbyProfiles(
  nearby: DiscoveryNearby,
  pageSize: number,
  filters: DiscoveryFilters,
  nowMs: number
): Promise<DiscoveryPageResponse> {
  const maxScanned = Math.min(
    MAX_SCAN_ABSOLUTE,
    Math.max(pageSize, pageSize * MAX_SCAN_MULTIPLIER)
  );
  const perBoundLimit = Math.max(
    1,
    Math.min(60, Math.ceil(maxScanned / nearby.bounds.length))
  );
  const snapshots = await Promise.all(
    nearby.bounds.map((bound) =>
      db
        .collection('public_profiles')
        .where('ageEligibilityAdultAccessAllowed', '==', true)
        .where('geohash', '>=', bound.start)
        .where('geohash', '<=', bound.end)
        .orderBy('geohash', 'asc')
        .limit(perBoundLimit)
        .get()
    )
  );
  const byUid = new Map<string, Record<string, unknown>>();
  let scanned = 0;

  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      scanned += 1;
      if (scanned > maxScanned || byUid.has(document.id)) {
        continue;
      }

      const card = serializePublicProfileForDiscovery(
        document.id,
        document.data() as Record<string, unknown>,
        nowMs
      );

      if (!card || !matchesDiscoveryFilters(card, filters)) {
        continue;
      }

      const latitude = finiteNumber(card['latitude']);
      const longitude = finiteNumber(card['longitude']);
      if (latitude === null || longitude === null) {
        continue;
      }

      const distanceKm = distanceKmBetween(
        nearby.latitude,
        nearby.longitude,
        latitude,
        longitude
      );

      if (distanceKm <= nearby.maxDistanceKm) {
        byUid.set(document.id, {
          ...card,
          distanciaKm: distanceKm,
          distanceKm,
        });
      }
    }
  }

  const items = [...byUid.values()]
    .sort((left, right) =>
      Number(left['distanciaKm'] ?? Number.POSITIVE_INFINITY)
      - Number(right['distanciaKm'] ?? Number.POSITIVE_INFINITY)
    )
    .slice(0, pageSize);

  return {
    items,
    nextCursor: null,
    reachedEnd: true,
    fetchedAt: nowMs,
    scanned: Math.min(scanned, maxScanned),
  };
}

async function getProfilesByUids(
  uids: readonly string[],
  nowMs: number
): Promise<DiscoveryPageResponse> {
  if (!uids.length) {
    return {
      items: [],
      nextCursor: null,
      reachedEnd: true,
      fetchedAt: nowMs,
      scanned: 0,
    };
  }

  const refs = uids.map((uid) => db.collection('public_profiles').doc(uid));
  const snapshots = await db.getAll(...refs);
  const byUid = new Map<string, Record<string, unknown>>();

  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;

    const card = serializePublicProfileForDiscovery(
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
      nowMs
    );

    if (card) byUid.set(snapshot.id, card);
  }

  return {
    items: uids
      .map((uid) => byUid.get(uid) ?? null)
      .filter((item): item is Record<string, unknown> => item !== null),
    nextCursor: null,
    reachedEnd: true,
    fetchedAt: nowMs,
    scanned: snapshots.length,
  };
}

export const getPublicProfilesPage = onCall<DiscoveryPageRequest>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<DiscoveryPageResponse> => {
    assertCallableAppCheck(request.app);

    const viewerUid = cleanUid(request.auth?.uid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    await assertInteractionAccess(viewerUid);

    const nowMs = Date.now();
    const requestedUids = normalizeUidList(request.data?.uids);

    if (requestedUids.length) {
      await consumeBackendRateLimitQuota({
        action: 'discovery-public-profile-read',
        subject: viewerUid,
        cost: discoveryReadRateLimitCost({ uidCount: requestedUids.length }),
        config: DISCOVERY_READ_RATE_LIMIT,
        message: 'Muitas consultas de perfis foram feitas em pouco tempo.',
        now: nowMs,
      });

      return getProfilesByUids(requestedUids, nowMs);
    }

    const pageSize = normalizePageSize(request.data?.pageSize);
    const nearby = normalizeNearby(request.data?.nearby);

    await consumeBackendRateLimitQuota({
      action: 'discovery-public-profile-read',
      subject: viewerUid,
      cost: discoveryReadRateLimitCost({ pageSize }),
      config: DISCOVERY_READ_RATE_LIMIT,
      message: 'Muitas consultas de perfis foram feitas em pouco tempo.',
      now: nowMs,
    });
    const mode = normalizeMode(request.data?.mode);
    const filters = normalizeFilters(request.data?.filters);

    if (nearby) {
      return getNearbyProfiles(nearby, pageSize, filters, nowMs);
    }

    const initialCursor = normalizeCursor(request.data?.cursor);
    const maxScanned = Math.min(
      MAX_SCAN_ABSOLUTE,
      Math.max(pageSize, pageSize * MAX_SCAN_MULTIPLIER)
    );
    const batchSize = Math.min(120, Math.max(24, pageSize * 2));

    if (filters.nicknamePrefix) {
      const prefix = filters.nicknamePrefix;
      const searchSnapshot = await db
        .collection('public_profiles')
        .where('nicknameNormalized', '>=', prefix)
        .where('nicknameNormalized', '<=', prefix + '\uf8ff')
        .orderBy('nicknameNormalized', 'asc')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(maxScanned)
        .get();
      const searchItems: Record<string, unknown>[] = [];

      for (const document of searchSnapshot.docs) {
        const card = serializePublicProfileForDiscovery(
          document.id,
          document.data() as Record<string, unknown>,
          nowMs
        );

        if (card && matchesDiscoveryFilters(card, filters)) {
          searchItems.push(card);
        }

        if (searchItems.length >= pageSize) {
          break;
        }
      }

      return {
        items: searchItems,
        nextCursor: null,
        reachedEnd: true,
        fetchedAt: nowMs,
        scanned: searchSnapshot.size,
      };
    }

    let cursor = initialCursor;
    let scanned = 0;
    let reachedEnd = false;
    const items: Record<string, unknown>[] = [];

    while (
      items.length < pageSize
      && scanned < maxScanned
      && !reachedEnd
    ) {
      let profilesQuery: FirebaseFirestore.Query = db
        .collection('public_profiles')
        .where('ageEligibilityAdultAccessAllowed', '==', true);

      if (mode === 'compatible') {
        profilesQuery = profilesQuery
          .where('compatibilityReady', '==', true);
      }

      profilesQuery = profilesQuery
        .orderBy('updatedAt', 'desc')
        .orderBy(FieldPath.documentId(), 'desc');

      if (cursor) {
        profilesQuery = profilesQuery.startAfter(
          Timestamp.fromMillis(cursor.updatedAtMs),
          cursor.uid
        );
      }

      const remainingScan = maxScanned - scanned;
      const currentBatchSize = Math.min(batchSize, remainingScan);
      const snapshot = await profilesQuery
        .limit(currentBatchSize)
        .get();

      if (snapshot.empty) {
        reachedEnd = true;
        break;
      }

      for (const document of snapshot.docs) {
        const updatedAtMs =
          timestampToMillis(document.data()['updatedAt']);

        if (updatedAtMs === null) continue;

        cursor = { uid: document.id, updatedAtMs };
        scanned += 1;

        const card = serializePublicProfileForDiscovery(
          document.id,
          document.data() as Record<string, unknown>,
          nowMs
        );

        if (card && matchesDiscoveryFilters(card, filters)) {
          items.push(card);
        }

        if (
          items.length >= pageSize
          || scanned >= maxScanned
        ) {
          break;
        }
      }

      if (snapshot.size < currentBatchSize) {
        reachedEnd = true;
      }
    }

    return {
      items,
      nextCursor: reachedEnd ? null : cursor,
      reachedEnd,
      fetchedAt: nowMs,
      scanned,
    };
  }
);
