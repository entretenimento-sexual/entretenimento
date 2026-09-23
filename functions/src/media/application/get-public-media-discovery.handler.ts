// functions/src/media/application/get-public-media-discovery.handler.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA DISCOVERY READ BOUNDARY
// -----------------------------------------------------------------------------
// Toda listagem pública de fotos/vídeos é backend-only, inclusive galerias
// owner-scoped. Deep links documentais permanecem protegidos diretamente pelas
// Rules; listas usam relógio do servidor e projeção etária vigente.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import {
  assertPublicMediaConsumptionAccess,
} from './public-media-consumption-access.policy';

type PublicMediaDiscoveryType = 'PHOTO' | 'VIDEO';
type PublicMediaDiscoveryMode =
  | 'PROFILE'
  | 'RECENT_BY_OWNERS'
  | 'LATEST'
  | 'TOP'
  | 'BOOSTED';

interface PublicMediaDiscoveryCursorInput {
  documentPath?: unknown;
  publishedAt?: unknown;
  score?: unknown;
  uniqueViewersCount?: unknown;
  viewsCount?: unknown;
  boostedUntil?: unknown;
  orderIndex?: unknown;
}

interface PublicMediaDiscoveryRequest {
  mediaType?: unknown;
  mode?: unknown;
  ownerUids?: unknown;
  limit?: unknown;
  cursor?: PublicMediaDiscoveryCursorInput | null;
}

interface PublicMediaDiscoveryCursor {
  documentPath: string;
  publishedAt: number;
  score: number;
  uniqueViewersCount: number;
  viewsCount: number;
  boostedUntil: number;
  orderIndex: number;
}

interface PublicMediaDiscoveryResponse {
  items: Record<string, unknown>[];
  nextCursor: PublicMediaDiscoveryCursor | null;
  hasMore: boolean;
  fetchedAt: number;
  scanned: number;
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const MAX_OWNER_UIDS = 30;
const MAX_SCAN_MULTIPLIER = 4;
const MAX_SCAN_ABSOLUTE = 240;

const PUBLIC_MEDIA_DISCOVERY_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 20,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 100,
});

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized)
    ? normalized
    : '';
}

function normalizeLimit(value: unknown): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : DEFAULT_LIMIT;

  return Math.min(MAX_LIMIT, Math.max(1, normalized));
}

function normalizeOwnerUids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => cleanId(item))
        .filter(Boolean)
    )
  ).slice(0, MAX_OWNER_UIDS);
}

function normalizeMediaType(value: unknown): PublicMediaDiscoveryType {
  if (value === 'PHOTO' || value === 'VIDEO') return value;

  throw new HttpsError(
    'invalid-argument',
    'Tipo de mídia pública inválido.'
  );
}

function normalizeMode(value: unknown): PublicMediaDiscoveryMode {
  if (
    value === 'PROFILE' ||
    value === 'RECENT_BY_OWNERS' ||
    value === 'LATEST' ||
    value === 'TOP' ||
    value === 'BOOSTED'
  ) {
    return value;
  }

  throw new HttpsError(
    'invalid-argument',
    'Modo de descoberta de mídia inválido.'
  );
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function positiveEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : null;
}

function timestampToMillis(value: unknown): number | null {
  const direct = positiveEpoch(value);
  if (direct !== null) return direct;

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    try {
      return positiveEpoch(
        (value as { toMillis: () => number }).toMillis()
      );
    } catch {
      return null;
    }
  }

  return null;
}

function toCallableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toCallableValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const timestampMs = timestampToMillis(value);
  if (timestampMs !== null) {
    return timestampMs;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    output[key] = toCallableValue(nestedValue);
  }

  return output;
}

function expectedPathSegment(mediaType: PublicMediaDiscoveryType): string {
  return mediaType === 'PHOTO' ? '/public_photos/' : '/public_videos/';
}

function normalizeCursor(
  value: PublicMediaDiscoveryCursorInput | null | undefined,
  mediaType: PublicMediaDiscoveryType
): PublicMediaDiscoveryCursor | null {
  if (!value) return null;

  const documentPath = String(value.documentPath ?? '').trim();

  if (!documentPath.includes(expectedPathSegment(mediaType))) {
    return null;
  }

  return {
    documentPath,
    publishedAt: nonNegativeNumber(value.publishedAt),
    score: nonNegativeNumber(value.score),
    uniqueViewersCount: nonNegativeNumber(value.uniqueViewersCount),
    viewsCount: nonNegativeNumber(value.viewsCount),
    boostedUntil: nonNegativeNumber(value.boostedUntil),
    orderIndex: nonNegativeNumber(value.orderIndex),
  };
}

export function publicMediaDiscoveryReadRateLimitCost(limit: number): number {
  const safeLimit = normalizeLimit(limit);
  return Math.max(1, Math.ceil(safeLimit / 24));
}

export function isCurrentPublicMediaExposure(
  data: Record<string, unknown>,
  nowMs: number
): boolean {
  const validUntilMs = timestampToMillis(
    data['ageEligibilityValidUntil']
  );

  return data['ageEligibilityAdultAccessAllowed'] === true
    && validUntilMs !== null
    && validUntilMs > nowMs
    && data['visibility'] === 'PUBLIC'
    && data['moderationStatus'] === 'APPROVED';
}

export function serializePublicMediaForDiscovery(
  documentId: string,
  documentPath: string,
  data: Record<string, unknown>,
  nowMs: number
): Record<string, unknown> | null {
  if (
    !cleanId(documentId) ||
    !cleanId(data['ownerUid']) ||
    !isCurrentPublicMediaExposure(data, nowMs)
  ) {
    return null;
  }

  return {
    ...(toCallableValue(data) as Record<string, unknown>),
    id: documentId,
    documentPath,
  };
}

function assertSupportedMode(
  mediaType: PublicMediaDiscoveryType,
  mode: PublicMediaDiscoveryMode,
  ownerUids: readonly string[]
): void {
  if (mode === 'PROFILE' && ownerUids.length !== 1) {
    throw new HttpsError(
      'invalid-argument',
      'Informe exatamente um proprietário para a galeria pública.'
    );
  }

  if (mode === 'RECENT_BY_OWNERS' && !ownerUids.length) {
    throw new HttpsError(
      'invalid-argument',
      'Informe ao menos um proprietário para esta consulta.'
    );
  }

  if (mediaType === 'VIDEO' && mode === 'BOOSTED') {
    throw new HttpsError(
      'invalid-argument',
      'Boost global não está disponível para vídeos nesta superfície.'
    );
  }
}

function applyOrderingAndCursor(input: {
  query: FirebaseFirestore.Query;
  mediaType: PublicMediaDiscoveryType;
  mode: PublicMediaDiscoveryMode;
  cursor: PublicMediaDiscoveryCursor | null;
  nowMs: number;
}): FirebaseFirestore.Query {
  let query = input.query;

  if (input.mode === 'PROFILE') {
    query = query
      .orderBy('orderIndex', 'asc')
      .orderBy('publishedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (input.cursor) {
      const documentId = input.cursor.documentPath.split('/').pop() ?? '';

      if (!cleanId(documentId)) {
        throw new HttpsError(
          'invalid-argument',
          'Cursor de galeria pública inválido.'
        );
      }

      query = query.startAfter(
        input.cursor.orderIndex,
        input.cursor.publishedAt,
        documentId
      );
    }

    return query;
  }

  if (input.mode === 'RECENT_BY_OWNERS' || input.mode === 'LATEST') {
    query = query
      .orderBy('publishedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (input.cursor) {
      query = query.startAfter(
        input.cursor.publishedAt,
        db.doc(input.cursor.documentPath)
      );
    }

    return query;
  }

  if (input.mode === 'TOP' && input.mediaType === 'PHOTO') {
    query = query
      .orderBy('score', 'desc')
      .orderBy('publishedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (input.cursor) {
      query = query.startAfter(
        input.cursor.score,
        input.cursor.publishedAt,
        db.doc(input.cursor.documentPath)
      );
    }

    return query;
  }

  if (input.mode === 'TOP') {
    query = query
      .orderBy('score', 'desc')
      .orderBy('uniqueViewersCount', 'desc')
      .orderBy('viewsCount', 'desc')
      .orderBy('publishedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (input.cursor) {
      query = query.startAfter(
        input.cursor.score,
        input.cursor.uniqueViewersCount,
        input.cursor.viewsCount,
        input.cursor.publishedAt,
        db.doc(input.cursor.documentPath)
      );
    }

    return query;
  }

  query = query
    .where('boostActive', '==', true)
    .where('boostedUntil', '>', input.nowMs)
    .orderBy('boostedUntil', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');

  if (input.cursor) {
    query = query.startAfter(
      input.cursor.boostedUntil,
      db.doc(input.cursor.documentPath)
    );
  }

  return query;
}

function buildCursor(
  document: FirebaseFirestore.QueryDocumentSnapshot
): PublicMediaDiscoveryCursor {
  const data = document.data();

  return {
    documentPath: document.ref.path,
    publishedAt: nonNegativeNumber(data['publishedAt']),
    score: nonNegativeNumber(data['score']),
    uniqueViewersCount: nonNegativeNumber(data['uniqueViewersCount']),
    viewsCount: nonNegativeNumber(data['viewsCount']),
    boostedUntil: nonNegativeNumber(data['boostedUntil']),
    orderIndex: nonNegativeNumber(data['orderIndex']),
  };
}

export const getPublicMediaDiscovery = onCall<PublicMediaDiscoveryRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request): Promise<PublicMediaDiscoveryResponse> => {
    assertPublicMediaCallableAppCheck(request.app);

    const viewerUid = cleanId(request.auth?.uid);
    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const mediaType = normalizeMediaType(request.data?.mediaType);
    const mode = normalizeMode(request.data?.mode);
    const ownerUids = normalizeOwnerUids(request.data?.ownerUids);
    const resultLimit = normalizeLimit(request.data?.limit);
    const cursor = normalizeCursor(request.data?.cursor, mediaType);
    const nowMs = Date.now();

    assertSupportedMode(mediaType, mode, ownerUids);

    await consumeBackendRateLimitQuota({
      action: 'public-media-discovery-read',
      subject: viewerUid,
      cost: publicMediaDiscoveryReadRateLimitCost(resultLimit),
      config: PUBLIC_MEDIA_DISCOVERY_RATE_LIMIT,
      message: 'Muitas consultas de mídia foram feitas em pouco tempo.',
      now: nowMs,
    });

    await assertPublicMediaConsumptionAccess(viewerUid);

    const collectionId =
      mediaType === 'PHOTO' ? 'public_photos' : 'public_videos';
    let mediaQuery: FirebaseFirestore.Query =
      mode === 'PROFILE'
        ? db
          .collection('public_profiles')
          .doc(ownerUids[0]!)
          .collection(collectionId)
        : db.collectionGroup(collectionId);

    mediaQuery = mediaQuery
      .where('ageEligibilityAdultAccessAllowed', '==', true)
      .where('visibility', '==', 'PUBLIC')
      .where('moderationStatus', '==', 'APPROVED');

    if (mode === 'RECENT_BY_OWNERS') {
      mediaQuery = mediaQuery.where('ownerUid', 'in', ownerUids);
    }

    mediaQuery = applyOrderingAndCursor({
      query: mediaQuery,
      mediaType,
      mode,
      cursor,
      nowMs,
    });

    const maxScanned = Math.min(
      MAX_SCAN_ABSOLUTE,
      Math.max(resultLimit + 1, resultLimit * MAX_SCAN_MULTIPLIER)
    );
    const snapshot = await mediaQuery.limit(maxScanned).get();
    const items: Record<string, unknown>[] = [];

    let stoppedEarly = false;
    let cursorDocument: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    for (const document of snapshot.docs) {
      cursorDocument = document;
      const serialized = serializePublicMediaForDiscovery(
        document.id,
        document.ref.path,
        document.data() as Record<string, unknown>,
        nowMs
      );

      if (serialized) {
        items.push(serialized);
      }

      if (items.length >= resultLimit) {
        stoppedEarly = true;
        break;
      }
    }

    const exhaustedSnapshot = !stoppedEarly;
    const mayHaveMore =
      stoppedEarly ||
      (exhaustedSnapshot && snapshot.size === maxScanned);
    const nextCursor =
      mayHaveMore && cursorDocument
        ? buildCursor(cursorDocument)
        : null;

    return {
      items,
      nextCursor,
      hasMore: nextCursor !== null,
      fetchedAt: nowMs,
      scanned: snapshot.size,
    };
  }
);
