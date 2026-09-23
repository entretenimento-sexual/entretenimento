// functions/src/media/application/get-public-media-discovery.handler.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA DISCOVERY READ BOUNDARY
// -----------------------------------------------------------------------------
// Collection-group discovery for public photos/videos is backend-only.
// Profile-scoped galleries remain directly readable because their Rules can
// bind a single owner and validate the parent's temporal/canonical age boundary.
// -----------------------------------------------------------------------------

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
  | 'RECENT_BY_OWNERS'
  | 'LATEST'
  | 'TOP'
  | 'BOOSTED';

interface PublicMediaDiscoveryRequest {
  mediaType?: unknown;
  mode?: unknown;
  ownerUids?: unknown;
  limit?: unknown;
}

interface PublicMediaDiscoveryResponse {
  items: Record<string, unknown>[];
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

  return data['ageEligibilityVerifiedAdult'] === true
    && validUntilMs !== null
    && validUntilMs > nowMs
    && data['visibility'] === 'PUBLIC'
    && data['moderationStatus'] === 'APPROVED';
}

export function serializePublicMediaForDiscovery(
  documentId: string,
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
  };
}

function assertSupportedMode(
  mediaType: PublicMediaDiscoveryType,
  mode: PublicMediaDiscoveryMode,
  ownerUids: readonly string[]
): void {
  if (mode === 'RECENT_BY_OWNERS' && !ownerUids.length) {
    throw new HttpsError(
      'invalid-argument',
      'Informe ao menos um proprietário para esta consulta.'
    );
  }

  if (
    mediaType === 'VIDEO' &&
    mode !== 'RECENT_BY_OWNERS'
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Modo não disponível para vídeos nesta superfície.'
    );
  }
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
    let mediaQuery: FirebaseFirestore.Query = db
      .collectionGroup(collectionId)
      .where('ageEligibilityVerifiedAdult', '==', true)
      .where('visibility', '==', 'PUBLIC')
      .where('moderationStatus', '==', 'APPROVED');

    if (mode === 'RECENT_BY_OWNERS') {
      mediaQuery = mediaQuery
        .where('ownerUid', 'in', ownerUids)
        .orderBy('publishedAt', 'desc');
    } else if (mode === 'LATEST') {
      mediaQuery = mediaQuery.orderBy('publishedAt', 'desc');
    } else if (mode === 'TOP') {
      mediaQuery = mediaQuery
        .orderBy('score', 'desc')
        .orderBy('publishedAt', 'desc');
    } else {
      mediaQuery = mediaQuery
        .where('boostActive', '==', true)
        .where('boostedUntil', '>', nowMs)
        .orderBy('boostedUntil', 'desc');
    }

    const maxScanned = Math.min(
      MAX_SCAN_ABSOLUTE,
      Math.max(resultLimit, resultLimit * MAX_SCAN_MULTIPLIER)
    );
    const snapshot = await mediaQuery.limit(maxScanned).get();
    const items: Record<string, unknown>[] = [];

    for (const document of snapshot.docs) {
      const serialized = serializePublicMediaForDiscovery(
        document.id,
        document.data() as Record<string, unknown>,
        nowMs
      );

      if (serialized) {
        items.push(serialized);
      }

      if (items.length >= resultLimit) {
        break;
      }
    }

    return {
      items,
      fetchedAt: nowMs,
      scanned: snapshot.size,
    };
  }
);
