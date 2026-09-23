// functions/src/friendship/application/get-pending-friend-requests.handler.ts
// -----------------------------------------------------------------------------
// PENDING FRIEND REQUESTS READ BOUNDARY
// -----------------------------------------------------------------------------
// Solicitações pendentes são privadas, mas continuam sendo conteúdo social.
// A listagem revalida viewer e contraparte no backend para que a passagem do
// tempo em ageEligibility.expiresAt retire a solicitação da UI sem nova escrita.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
  assertInteractionAccessData,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';

type FriendRequestDirection = 'inbound' | 'outbound';

interface PendingFriendRequestsRequest {
  direction?: unknown;
  limit?: unknown;
}

interface PendingFriendRequestItem {
  id: string;
  requesterUid: string;
  targetUid: string;
  message: string | null;
  status: 'pending';
  createdAt: number | null;
  updatedAt: number | null;
}

interface PendingFriendRequestsResponse {
  items: PendingFriendRequestItem[];
  fetchedAt: number;
  scanned: number;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

const FRIEND_REQUEST_READ_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 20,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 100,
});

function cleanUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

function normalizeDirection(value: unknown): FriendRequestDirection {
  if (value === 'inbound' || value === 'outbound') {
    return value;
  }

  throw new HttpsError(
    'invalid-argument',
    'Direção da solicitação de amizade inválida.'
  );
}

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function toMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    try {
      const millis = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(millis) ? Math.trunc(millis) : null;
    } catch {
      return null;
    }
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? Math.trunc(millis) : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : null;
}

function normalizeMessage(value: unknown): string | null {
  const message = String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return message ? message.slice(0, 200) : null;
}

export function friendRequestCounterpartUid(
  data: Record<string, unknown>,
  direction: FriendRequestDirection
): string {
  return cleanUid(
    direction === 'inbound'
      ? data['requesterUid']
      : data['targetUid']
  );
}

export const getPendingFriendRequests =
  onCall<PendingFriendRequestsRequest>(
    {
      region: FUNCTIONS_REGION,
      invoker: 'public',
      enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
    },
    async (request): Promise<PendingFriendRequestsResponse> => {
      assertCallableAppCheck(request.app);

      const viewerUid = cleanUid(request.auth?.uid);
      if (!viewerUid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      await assertInteractionAccess(viewerUid);

      const direction = normalizeDirection(request.data?.direction);
      const limit = normalizeLimit(request.data?.limit);
      const nowMs = Date.now();

      await consumeBackendRateLimitQuota({
        action: 'pending-friend-requests-read',
        subject: viewerUid,
        cost: Math.max(1, Math.ceil(limit / 30)),
        config: FRIEND_REQUEST_READ_RATE_LIMIT,
        message: 'Muitas consultas de solicitações foram feitas em pouco tempo.',
        now: nowMs,
      });

      const ownerField =
        direction === 'inbound' ? 'targetUid' : 'requesterUid';
      const snapshot = await db
        .collection('friendRequests')
        .where(ownerField, '==', viewerUid)
        .where('status', '==', 'pending')
        .limit(MAX_LIMIT)
        .get();

      const candidates = snapshot.docs.flatMap((document) => {
        const data = document.data() as Record<string, unknown>;
        const requesterUid = cleanUid(data['requesterUid']);
        const targetUid = cleanUid(data['targetUid']);
        const counterpartUid = friendRequestCounterpartUid(data, direction);

        if (!requesterUid || !targetUid || !counterpartUid) {
          return [];
        }

        return [{
          document,
          data,
          requesterUid,
          targetUid,
          counterpartUid,
        }];
      });

      const counterpartUids = [
        ...new Set(candidates.map((candidate) => candidate.counterpartUid)),
      ];
      const userRefs = counterpartUids.map((uid) =>
        db.collection('users').doc(uid)
      );
      const ageRefs = counterpartUids.map((uid) =>
        db.collection('age_eligibility_records').doc(uid)
      );
      const [userSnapshots, ageSnapshots] = await Promise.all([
        userRefs.length ? db.getAll(...userRefs) : Promise.resolve([]),
        ageRefs.length ? db.getAll(...ageRefs) : Promise.resolve([]),
      ]);
      const userByUid = new Map(
        userSnapshots.map((item) => [
          item.id,
          item.exists ? item.data() ?? null : null,
        ])
      );
      const ageByUid = new Map(
        ageSnapshots.map((item) => [
          item.id,
          item.exists ? item.data() ?? null : null,
        ])
      );

      const items: PendingFriendRequestItem[] = [];

      for (const candidate of candidates) {
        try {
          assertInteractionAccessData(
            userByUid.get(candidate.counterpartUid),
            ageByUid.get(candidate.counterpartUid),
            candidate.counterpartUid
          );
        } catch {
          continue;
        }

        items.push({
          id: candidate.document.id,
          requesterUid: candidate.requesterUid,
          targetUid: candidate.targetUid,
          message: normalizeMessage(candidate.data['message']),
          status: 'pending',
          createdAt: toMillis(candidate.data['createdAt']),
          updatedAt: toMillis(candidate.data['updatedAt']),
        });
      }

      items.sort((left, right) =>
        (right.createdAt ?? 0) - (left.createdAt ?? 0)
        || left.id.localeCompare(right.id)
      );

      return {
        items: items.slice(0, limit),
        fetchedAt: nowMs,
        scanned: snapshot.size,
      };
    }
  );
