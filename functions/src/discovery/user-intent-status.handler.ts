// functions/src/discovery/user-intent-status.handler.ts
// -----------------------------------------------------------------------------
// USER INTENT STATUS HANDLERS
// -----------------------------------------------------------------------------
// Publicação segura do "Status de Hoje".
//
// Decisão:
// - o cliente não grava status diretamente no Firestore;
// - a Function usa request.auth.uid como identidade real;
// - snapshots públicos vêm do documento users/{uid};
// - startsAt/expiresAt são definidos no servidor para evitar erro de relógio;
// - localização continua regional, sem coordenada precisa;
// - venueId só é aceito quando aponta para estabelecimento ativo e visível.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  assertMessagingAccountOperational,
} from '../chat/shared/messaging-account.policy';
import type { MessagingUserDoc } from '../chat/shared/messaging.types';

const MAX_STATUS_DURATION_HOURS = 12;
const DEFAULT_STATUS_DURATION_HOURS = 12;

const ALLOWED_AVAILABILITY = new Set([
  'available_now',
  'available_today',
  'planning_later',
]);

const ALLOWED_VISIBILITY = new Set([
  'public_discovery',
  'members_only',
  'friends_only',
]);

const ALLOWED_DESTINATION_KIND = new Set([
  'region',
  'venue',
  'event',
  'undecided',
]);

interface PublishUserIntentStatusRequest {
  availability?: unknown;
  visibility?: unknown;
  destination?: unknown;
  durationHours?: unknown;
}

interface UserIntentStatusDestinationInput {
  kind?: unknown;
  label?: unknown;
  venueId?: unknown;
  region?: unknown;
}

interface UserIntentStatusRegionInput {
  uf?: unknown;
  city?: unknown;
}

interface NormalizedDestination {
  kind: string;
  label: string;
  venueId: string | null;
  region: { uf: string; city: string };
}

interface UserIntentStatusResponse {
  statusId: string;
  expiresAt: number;
  state: 'active' | 'hidden';
}

function normalizeEnum(
  value: unknown,
  allowed: Set<string>,
  fallback: string
): string {
  const normalized = String(value ?? '').trim();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeText(
  value: unknown,
  options: { min: number; max: number; fallback?: string }
): string {
  const normalized = String(value ?? options.fallback ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  if (normalized.length < options.min) {
    throw new HttpsError('invalid-argument', 'Texto do status inválido.');
  }

  return normalized.slice(0, options.max);
}

function normalizeDurationHours(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_STATUS_DURATION_HOURS);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_STATUS_DURATION_HOURS;
  }

  return Math.min(
    Math.max(Math.trunc(parsed), 1),
    MAX_STATUS_DURATION_HOURS
  );
}

function normalizeRegion(raw: unknown, user: MessagingUserDoc): {
  uf: string;
  city: string;
} {
  const source = raw as UserIntentStatusRegionInput | null | undefined;
  const fallbackUf = String((user as any).estado ?? '').trim().toUpperCase();
  const fallbackCity = String((user as any).municipio ?? '').trim().toLowerCase();
  const uf = String(source?.uf ?? fallbackUf).trim().toUpperCase();
  const city = String(source?.city ?? fallbackCity).trim().toLowerCase();

  if (!/^[A-Z]{2}$/.test(uf) || city.length < 1 || city.length > 80) {
    throw new HttpsError('invalid-argument', 'Região do status inválida.');
  }

  return { uf, city };
}

function normalizeDestination(raw: unknown, user: MessagingUserDoc): NormalizedDestination {
  const source = raw as UserIntentStatusDestinationInput | null | undefined;
  const region = normalizeRegion(source?.region, user);
  const kind = normalizeEnum(
    source?.kind,
    ALLOWED_DESTINATION_KIND,
    'region'
  );
  const label = normalizeText(source?.label, {
    min: 2,
    max: 80,
    fallback: region.city || region.uf,
  });
  const venueId = String(source?.venueId ?? '').trim();

  return {
    kind,
    label,
    venueId: kind === 'venue' && venueId ? venueId.slice(0, 120) : null,
    region,
  };
}

async function resolveVenueDestination(
  destination: NormalizedDestination
): Promise<NormalizedDestination> {
  if (destination.kind !== 'venue' || !destination.venueId) {
    return {
      ...destination,
      venueId: null,
    };
  }

  const venueSnapshot = await db.collection('venues').doc(destination.venueId).get();

  if (!venueSnapshot.exists) {
    throw new HttpsError('not-found', 'Estabelecimento não encontrado.');
  }

  const venue = venueSnapshot.data() as {
    name?: unknown;
    region?: { uf?: unknown; city?: unknown };
    visibility?: unknown;
    moderation?: { state?: unknown };
  };

  if (
    venue.moderation?.state !== 'active' ||
    (venue.visibility !== 'public' && venue.visibility !== 'members_only')
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Estabelecimento indisponível para status.'
    );
  }

  const uf = String(venue.region?.uf ?? '').trim().toUpperCase();
  const city = String(venue.region?.city ?? '').trim().toLowerCase();
  const label = normalizeText(venue.name, { min: 2, max: 80 });

  if (!/^[A-Z]{2}$/.test(uf) || city.length < 1 || city.length > 80) {
    throw new HttpsError(
      'failed-precondition',
      'Estabelecimento sem região válida.'
    );
  }

  return {
    kind: 'venue',
    label,
    venueId: destination.venueId,
    region: { uf, city },
  };
}

function publicProfileFromUser(uid: string, user: MessagingUserDoc): {
  uid: string;
  nickname: string;
  photoURL: string | null;
  age: number | null;
} {
  const nickname = normalizeText(user.nickname, { min: 2, max: 40 });
  const photoURL = String(user.photoURL ?? '').trim();
  const age = Number((user as any).idade);

  return {
    uid,
    nickname,
    photoURL: photoURL ? photoURL.slice(0, 600) : null,
    age: Number.isFinite(age) && age >= 18 && age <= 120
      ? Math.trunc(age)
      : null,
  };
}

export const publishUserIntentStatus = onCall<PublishUserIntentStatusRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<UserIntentStatusResponse> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const userSnapshot = await db.collection('users').doc(uid).get();
    const user = userSnapshot.data() as MessagingUserDoc | undefined;

    assertMessagingAccountOperational(user, {
      operation: 'publish-user-intent-status',
      perspective: 'actor',
    });

    const now = Date.now();
    const durationHours = normalizeDurationHours(request.data?.durationHours);
    const expiresAt = now + durationHours * 60 * 60 * 1000;
    const statusId = `current_${uid}`;
    const statusRef = db.collection('user_intent_statuses').doc(statusId);
    const auditRef = db.collection('user_intent_status_audit').doc();

    const availability = normalizeEnum(
      request.data?.availability,
      ALLOWED_AVAILABILITY,
      'available_today'
    );
    const visibility = normalizeEnum(
      request.data?.visibility,
      ALLOWED_VISIBILITY,
      'public_discovery'
    );
    const destination = await resolveVenueDestination(
      normalizeDestination(request.data?.destination, user!)
    );
    const profile = publicProfileFromUser(uid, user!);

    await db.runTransaction(async (tx) => {
      tx.set(statusRef, {
        uid,
        profile,
        availability,
        visibility,
        destination,
        moderation: {
          state: 'active',
          reviewedAt: null,
          reviewedBy: null,
          reason: null,
        },
        startsAt: now,
        expiresAt,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(auditRef, {
        action: 'publish_user_intent_status',
        actorUid: uid,
        statusId,
        destinationKind: destination.kind,
        destinationVenueId: destination.venueId,
        destinationRegion: destination.region,
        visibility,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      statusId,
      expiresAt,
      state: 'active',
    };
  }
);

export const hideUserIntentStatus = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<UserIntentStatusResponse> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const userSnapshot = await db.collection('users').doc(uid).get();
    const user = userSnapshot.data() as MessagingUserDoc | undefined;

    assertMessagingAccountOperational(user, {
      operation: 'hide-user-intent-status',
      perspective: 'actor',
    });

    const statusId = `current_${uid}`;
    const statusRef = db.collection('user_intent_statuses').doc(statusId);
    const auditRef = db.collection('user_intent_status_audit').doc();

    await db.runTransaction(async (tx) => {
      const statusSnapshot = await tx.get(statusRef);

      if (!statusSnapshot.exists) {
        throw new HttpsError('not-found', 'Status não encontrado.');
      }

      const status = statusSnapshot.data() as { uid?: unknown };

      if (status.uid !== uid) {
        throw new HttpsError('permission-denied', 'Status não pertence ao usuário.');
      }

      tx.set(statusRef, {
        moderation: {
          state: 'hidden',
          reviewedAt: null,
          reviewedBy: null,
          reason: null,
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(auditRef, {
        action: 'hide_user_intent_status',
        actorUid: uid,
        statusId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      statusId,
      expiresAt: Date.now(),
      state: 'hidden',
    };
  }
);
