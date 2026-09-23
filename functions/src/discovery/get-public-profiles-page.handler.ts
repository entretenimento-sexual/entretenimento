// functions/src/discovery/get-public-profiles-page.handler.ts
// -----------------------------------------------------------------------------
// DISCOVERY PUBLIC PROFILES READ BOUNDARY
// -----------------------------------------------------------------------------
// Listagem paginada server-owned. A passagem do relógio invalida a exposição
// mesmo que a projeção materializada ainda não tenha sido atualizada pela Task.
// -----------------------------------------------------------------------------

import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertInteractionAccess } from '../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';

type DiscoveryMode = 'all' | 'compatible';

interface DiscoveryCursor {
  updatedAtMs?: unknown;
  uid?: unknown;
}

interface DiscoveryPageRequest {
  mode?: unknown;
  pageSize?: unknown;
  cursor?: DiscoveryCursor | null;
}

interface DiscoveryPageCursor {
  updatedAtMs: number;
  uid: string;
}

interface DiscoveryPageResponse {
  items: Record<string, unknown>[];
  nextCursor: DiscoveryPageCursor | null;
  reachedEnd: boolean;
  fetchedAt: number;
  scanned: number;
}

const MIN_PAGE_SIZE = 6;
const MAX_PAGE_SIZE = 48;
const MAX_SCAN_MULTIPLIER = 6;
const MAX_SCAN_ABSOLUTE = 288;

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

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result = Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  ));
  return result.length ? result : null;
}

function currentAdultProjection(
  data: Record<string, unknown>,
  nowMs: number
): boolean {
  const validUntilMs = timestampToMillis(data['ageEligibilityValidUntil']);
  return data['ageEligibilityVerifiedAdult'] === true
    && validUntilMs !== null
    && validUntilMs > nowMs;
}

function serializePublicProfile(
  uid: string,
  data: Record<string, unknown>,
  nowMs: number
): Record<string, unknown> | null {
  const nickname = cleanText(data['nickname']);
  if (!uid || !nickname || !currentAdultProjection(data, nowMs)) return null;

  const validUntilMs = timestampToMillis(data['ageEligibilityValidUntil']);
  const latitude = finiteNumber(data['latitude']);
  const longitude = finiteNumber(data['longitude']);
  const coordinatesValid =
    latitude !== null && longitude !== null && !(latitude === 0 && longitude === 0);

  return {
    uid,
    nickname,
    nicknameNormalized: cleanText(data['nicknameNormalized']) ?? nickname.toLowerCase(),
    photoURL: cleanText(data['photoURL'] ?? data['avatarUrl']),
    gender: cleanText(data['gender']),
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
    preferences: cleanStringArray(data['preferences']) ?? cleanText(data['preferences']),
    interestedInGenders:
      cleanStringArray(data['interestedInGenders'])
      ?? cleanText(data['interestedInGenders']),
    interestedInOrientations:
      cleanStringArray(data['interestedInOrientations'])
      ?? cleanText(data['interestedInOrientations']),
    publicRelationshipIntents: cleanStringArray(data['publicRelationshipIntents']),
    publicSexualPractices: cleanStringArray(data['publicSexualPractices']),
    publicBodyTraits: cleanStringArray(data['publicBodyTraits']),
    preferenceBadgesVisible:
      typeof data['preferenceBadgesVisible'] === 'boolean'
        ? data['preferenceBadgesVisible']
        : null,
    publicPreferencesUpdatedAt: timestampToMillis(data['publicPreferencesUpdatedAt']),
    municipio: cleanText(data['municipio']),
    estado: cleanText(data['estado']),
    role: cleanText(data['role']) ?? 'free',
    latitude: coordinatesValid ? latitude : null,
    longitude: coordinatesValid ? longitude : null,
    geohash: coordinatesValid ? cleanText(data['geohash']) : null,
    isOnline: data['isOnline'] === true,
    lastSeen: timestampToMillis(data['lastSeen']),
    lastOnlineAt: timestampToMillis(data['lastOnlineAt']),
    lastOfflineAt: timestampToMillis(data['lastOfflineAt']),
    createdAt: timestampToMillis(data['createdAt']),
    updatedAt: timestampToMillis(data['updatedAt']),
    mediaCount: finiteNumber(data['mediaCount'] ?? data['publicMediaCount']),
    photosCount: finiteNumber(data['photosCount'] ?? data['publicPhotosCount']),
    videosCount: finiteNumber(data['videosCount'] ?? data['publicVideosCount']),
    viewsCount: finiteNumber(data['viewsCount'] ?? data['profileViewsCount']),
    profileUniqueViewersCount:
      finiteNumber(data['profileUniqueViewersCount'] ?? data['uniqueViewersCount']),
    uniqueViewersCount:
      finiteNumber(data['profileUniqueViewersCount'] ?? data['uniqueViewersCount']),
    mediaUniqueViewersCount: finiteNumber(data['mediaUniqueViewersCount']),
    likesCount: finiteNumber(data['likesCount'] ?? data['publicLikesCount']),
    reactionsCount:
      finiteNumber(data['reactionsCount'])
      ?? finiteNumber(data['likesCount'] ?? data['publicLikesCount']),
    viewScore: finiteNumber(data['viewScore']),
    engagementScore: finiteNumber(data['engagementScore']),
    profileCompletenessScore: finiteNumber(data['profileCompletenessScore']),
    mediaMetricsUpdatedAt: timestampToMillis(data['mediaMetricsUpdatedAt']),
    ageEligibilityVerifiedAdult: true,
    ageEligibilityValidUntil: validUntilMs,
  };
}

export const getPublicProfilesPage = onCall<DiscoveryPageRequest>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<DiscoveryPageResponse> => {
    const viewerUid = cleanUid(request.auth?.uid);
    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    await assertInteractionAccess(viewerUid);

    const pageSize = normalizePageSize(request.data?.pageSize);
    const mode = normalizeMode(request.data?.mode);
    const initialCursor = normalizeCursor(request.data?.cursor);
    const nowMs = Date.now();
    const maxScanned = Math.min(
      MAX_SCAN_ABSOLUTE,
      Math.max(pageSize, pageSize * MAX_SCAN_MULTIPLIER)
    );
    const batchSize = Math.min(96, Math.max(24, pageSize * 2));

    let cursor = initialCursor;
    let scanned = 0;
    let reachedEnd = false;
    const items: Record<string, unknown>[] = [];

    while (items.length < pageSize && scanned < maxScanned && !reachedEnd) {
      let profilesQuery: FirebaseFirestore.Query = db
        .collection('public_profiles')
        .where('ageEligibilityVerifiedAdult', '==', true);

      if (mode === 'compatible') {
        profilesQuery = profilesQuery.where('compatibilityReady', '==', true);
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
      const snapshot = await profilesQuery
        .limit(Math.min(batchSize, remainingScan))
        .get();

      if (snapshot.empty) {
        reachedEnd = true;
        break;
      }

      for (const document of snapshot.docs) {
        const updatedAtMs = timestampToMillis(document.data()['updatedAt']);
        if (updatedAtMs === null) continue;

        cursor = { uid: document.id, updatedAtMs };
        scanned += 1;

        const card = serializePublicProfile(
          document.id,
          document.data() as Record<string, unknown>,
          nowMs
        );

        if (card) items.push(card);
        if (items.length >= pageSize || scanned >= maxScanned) break;
      }

      if (snapshot.size < Math.min(batchSize, remainingScan)) {
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
