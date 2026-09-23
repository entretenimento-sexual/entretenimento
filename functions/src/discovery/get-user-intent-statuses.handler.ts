// functions/src/discovery/get-user-intent-statuses.handler.ts
// -----------------------------------------------------------------------------
// USER INTENT STATUS READ BOUNDARY
// -----------------------------------------------------------------------------
// Listagens públicas de "Status de Hoje" passam por uma fronteira backend-time.
// O cliente não enumera user_intent_statuses diretamente. A elegibilidade 18+
// projetada é revalidada contra o relógio do servidor antes de qualquer item
// sair da Callable, inclusive durante eventual atraso da materialização.
// -----------------------------------------------------------------------------

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

interface UserIntentStatusesRegionInput {
  uf?: unknown;
  city?: unknown;
}

interface UserIntentStatusesReadRequest {
  region?: UserIntentStatusesRegionInput | null;
  limit?: unknown;
  venueId?: unknown;
  ownerUids?: unknown;
}

interface UserIntentStatusesReadResponse {
  items: Record<string, unknown>[];
  fetchedAt: number;
  scanned: number;
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const MAX_SCAN_MULTIPLIER = 4;
const MAX_SCAN_ABSOLUTE = 240;
const MAX_OWNER_UIDS = 30;

const STATUS_READ_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 20,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 100,
});

const ALLOWED_AVAILABILITY = new Set([
  'available_now',
  'available_today',
  'planning_later',
]);

const ALLOWED_DESTINATION_KIND = new Set([
  'region',
  'venue',
  'event',
  'undecided',
]);

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function cleanUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
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

function normalizeLimit(value: unknown): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : DEFAULT_LIMIT;

  return Math.min(MAX_LIMIT, Math.max(1, normalized));
}

function normalizeRegion(value: unknown): { uf: string; city: string } {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  const uf = String(source['uf'] ?? '').trim().toUpperCase();
  const city = String(source['city'] ?? '').trim().toLowerCase();

  if (!/^[A-Z]{2}$/.test(uf) || city.length < 1 || city.length > 80) {
    throw new HttpsError('invalid-argument', 'Região do status inválida.');
  }

  return { uf, city };
}

function normalizeOwnerUids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => cleanUid(item))
        .filter(Boolean)
    )
  ).slice(0, MAX_OWNER_UIDS);
}

export function userIntentStatusReadRateLimitCost(limit: number): number {
  const safeLimit = normalizeLimit(limit);
  return Math.max(1, Math.ceil(safeLimit / 24));
}

export function isCurrentUserIntentStatusExposure(
  data: Record<string, unknown>,
  nowMs: number
): boolean {
  const validUntilMs = timestampToMillis(
    data['ageEligibilityValidUntil']
  );
  const expiresAtMs = positiveEpoch(data['expiresAt']);
  const moderation =
    data['moderation'] && typeof data['moderation'] === 'object'
      ? data['moderation'] as Record<string, unknown>
      : {};

  return data['ageEligibilityAdultAccessAllowed'] === true
    && validUntilMs !== null
    && validUntilMs > nowMs
    && expiresAtMs !== null
    && expiresAtMs > nowMs
    && moderation['state'] === 'active'
    && data['visibility'] === 'public_discovery';
}

export function serializeUserIntentStatusForDiscovery(
  id: string,
  data: Record<string, unknown>,
  nowMs: number
): Record<string, unknown> | null {
  if (!id || !isCurrentUserIntentStatusExposure(data, nowMs)) {
    return null;
  }

  const uid = cleanUid(data['uid']);
  const rawProfile =
    data['profile'] && typeof data['profile'] === 'object'
      ? data['profile'] as Record<string, unknown>
      : {};
  const nickname = cleanText(rawProfile['nickname']);
  const rawDestination =
    data['destination'] && typeof data['destination'] === 'object'
      ? data['destination'] as Record<string, unknown>
      : {};
  const rawRegion =
    rawDestination['region'] &&
    typeof rawDestination['region'] === 'object'
      ? rawDestination['region'] as Record<string, unknown>
      : {};
  const uf = String(rawRegion['uf'] ?? '').trim().toUpperCase();
  const city = String(rawRegion['city'] ?? '').trim().toLowerCase();
  const label = cleanText(rawDestination['label']);
  const kind = String(rawDestination['kind'] ?? '').trim();
  const availability = String(data['availability'] ?? '').trim();

  if (
    !uid ||
    !nickname ||
    !/^[A-Z]{2}$/.test(uf) ||
    !city ||
    city.length > 80 ||
    !label
  ) {
    return null;
  }

  return {
    id,
    uid,
    profile: {
      uid,
      nickname,
      photoURL: cleanText(rawProfile['photoURL']),
      // A prova de maioridade não autoriza reprojetar idade exata.
      age: null,
    },
    availability: ALLOWED_AVAILABILITY.has(availability)
      ? availability
      : 'available_today',
    visibility: 'public_discovery',
    destination: {
      kind: ALLOWED_DESTINATION_KIND.has(kind) ? kind : 'undecided',
      label,
      venueId: cleanText(rawDestination['venueId']),
      region: { uf, city },
    },
    moderation: {
      state: 'active',
      reviewedAt: null,
      reviewedBy: null,
      reason: null,
    },
    startsAt: positiveEpoch(data['startsAt']) ?? 0,
    expiresAt: positiveEpoch(data['expiresAt']),
    ageEligibilityValidUntil:
      timestampToMillis(data['ageEligibilityValidUntil']),
    createdAt: timestampToMillis(data['createdAt']),
    updatedAt: timestampToMillis(data['updatedAt']),
  };
}

export const getUserIntentStatuses = onCall<UserIntentStatusesReadRequest>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<UserIntentStatusesReadResponse> => {
    assertCallableAppCheck(request.app);

    const viewerUid = cleanUid(request.auth?.uid);
    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const region = normalizeRegion(request.data?.region);
    const resultLimit = normalizeLimit(request.data?.limit);
    const venueId = cleanText(request.data?.venueId);
    const ownerUids = normalizeOwnerUids(request.data?.ownerUids);
    const nowMs = Date.now();

    await consumeBackendRateLimitQuota({
      action: 'user-intent-status-public-read',
      subject: viewerUid,
      cost: userIntentStatusReadRateLimitCost(resultLimit),
      config: STATUS_READ_RATE_LIMIT,
      message: 'Muitas consultas de status foram feitas em pouco tempo.',
      now: nowMs,
    });

    await assertInteractionAccess(viewerUid);

    let statusesQuery: FirebaseFirestore.Query = db
      .collection('user_intent_statuses')
      .where('destination.region.uf', '==', region.uf)
      .where('destination.region.city', '==', region.city)
      .where('moderation.state', '==', 'active')
      .where('visibility', '==', 'public_discovery')
      .where('ageEligibilityAdultAccessAllowed', '==', true);

    if (venueId) {
      statusesQuery = statusesQuery.where(
        'destination.venueId',
        '==',
        venueId
      );
    }

    if (ownerUids.length) {
      statusesQuery = statusesQuery.where('uid', 'in', ownerUids);
    }

    const maxScanned = Math.min(
      MAX_SCAN_ABSOLUTE,
      Math.max(resultLimit, resultLimit * MAX_SCAN_MULTIPLIER)
    );

    const snapshot = await statusesQuery
      .where('expiresAt', '>', nowMs)
      .orderBy('expiresAt', 'asc')
      .limit(maxScanned)
      .get();

    const items: Record<string, unknown>[] = [];

    for (const document of snapshot.docs) {
      const serialized = serializeUserIntentStatusForDiscovery(
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
