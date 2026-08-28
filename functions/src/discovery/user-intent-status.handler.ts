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
// - venueId só é aceito quando aponta para estabelecimento ativo e visível;
// - notificação própria confirma publicação;
// - notificação compatível exige opt-in, região igual, elegibilidade e anti-spam.
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
const MAX_COMPATIBLE_STATUS_NOTIFICATIONS = 10;

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

interface NotificationPreferencesDoc {
  notificationPreferences?: {
    compatibleStatus?: unknown;
  };
}

interface CompatibleNotificationCandidate {
  targetUid: string;
  targetUser: MessagingUserDoc;
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

function buildStatusPublishedNotificationId(uid: string): string {
  return `user_intent_status_active_${uid}`;
}

function buildCompatibleStatusNotificationId(
  targetUid: string,
  actorUid: string,
  statusId: string
): string {
  return `compatible_status_${targetUid}_${actorUid}_${statusId}`;
}

function buildStatusPublishedNotificationBody(destination: NormalizedDestination): string {
  if (destination.kind === 'venue') {
    return `Seu status está ativo em ${destination.label}.`;
  }

  return `Seu status está ativo em ${destination.region.city}.`;
}

function buildCompatibleStatusBody(destination: NormalizedDestination): string {
  if (destination.kind === 'venue') {
    return `Há um status compatível ativo em ${destination.label}.`;
  }

  return `Há um status compatível ativo na sua região.`;
}

function normalizeUserRegion(user: MessagingUserDoc | undefined): {
  uf: string;
  city: string;
} {
  return {
    uf: String((user as any)?.estado ?? '').trim().toUpperCase(),
    city: String((user as any)?.municipio ?? '').trim().toLowerCase(),
  };
}

function isOperationalCandidate(user: MessagingUserDoc | undefined): boolean {
  if (!user?.uid || (user as any).profileCompleted !== true) {
    return false;
  }

  const accountStatus = String((user as any).accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  return accountStatus === 'active' &&
    (user as any).interactionBlocked !== true &&
    (user as any).accountLocked !== true &&
    (user as any).loginAllowed !== false;
}

function isSameRegion(
  user: MessagingUserDoc | undefined,
  destination: NormalizedDestination
): boolean {
  const userRegion = normalizeUserRegion(user);
  return userRegion.uf === destination.region.uf &&
    userRegion.city === destination.region.city;
}

function shouldNotifyCompatibleStatus(visibility: string): boolean {
  return visibility === 'public_discovery';
}

async function hasActiveBlockBetween(actorUid: string, targetUid: string): Promise<boolean> {
  const [actorBlockSnapshot, targetBlockSnapshot] = await Promise.all([
    db.collection('users').doc(actorUid).collection('blocks').doc(targetUid).get(),
    db.collection('users').doc(targetUid).collection('blocks').doc(actorUid).get(),
  ]);

  return actorBlockSnapshot.data()?.['isBlocked'] === true ||
    targetBlockSnapshot.data()?.['isBlocked'] === true;
}

async function findCompatibleNotificationCandidates(
  actorUid: string,
  destination: NormalizedDestination
): Promise<CompatibleNotificationCandidate[]> {
  const preferencesSnapshot = await db
    .collection('preferences')
    .where('notificationPreferences.compatibleStatus', '==', true)
    .limit(MAX_COMPATIBLE_STATUS_NOTIFICATIONS * 3)
    .get();

  const candidates: CompatibleNotificationCandidate[] = [];

  for (const preferenceDoc of preferencesSnapshot.docs) {
    const targetUid = preferenceDoc.id;

    if (targetUid === actorUid) {
      continue;
    }

    const preferences = preferenceDoc.data() as NotificationPreferencesDoc;

    if (preferences.notificationPreferences?.compatibleStatus !== true) {
      continue;
    }

    const targetSnapshot = await db.collection('users').doc(targetUid).get();
    const targetUser = targetSnapshot.data() as MessagingUserDoc | undefined;

    if (!isOperationalCandidate(targetUser) || !isSameRegion(targetUser, destination)) {
      continue;
    }

    if (await hasActiveBlockBetween(actorUid, targetUid)) {
      continue;
    }

    candidates.push({ targetUid, targetUser: targetUser! });

    if (candidates.length >= MAX_COMPATIBLE_STATUS_NOTIFICATIONS) {
      break;
    }
  }

  return candidates;
}

async function notifyCompatibleStatusSubscribers(params: {
  actorUid: string;
  statusId: string;
  destination: NormalizedDestination;
  visibility: string;
}): Promise<number> {
  if (!shouldNotifyCompatibleStatus(params.visibility)) {
    return 0;
  }

  const candidates = await findCompatibleNotificationCandidates(
    params.actorUid,
    params.destination
  );

  let created = 0;

  for (const candidate of candidates) {
    const notificationId = buildCompatibleStatusNotificationId(
      candidate.targetUid,
      params.actorUid,
      params.statusId
    );
    const notificationRef = db.collection('notifications').doc(notificationId);
    const existingNotification = await notificationRef.get();

    if (existingNotification.exists) {
      continue;
    }

    await notificationRef.set({
      userId: candidate.targetUid,
      type: 'user_intent_status.compatible',
      title: 'Status compatível ativo',
      body: buildCompatibleStatusBody(params.destination),
      route: '/descobrir',
      statusId: params.statusId,
      actorUid: params.actorUid,
      destinationKind: params.destination.kind,
      destinationVenueId: params.destination.venueId,
      destinationRegion: params.destination.region,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });

    created += 1;
  }

  if (created > 0) {
    await db.collection('user_intent_status_audit').add({
      action: 'notify_compatible_user_intent_status',
      actorUid: params.actorUid,
      statusId: params.statusId,
      destinationRegion: params.destination.region,
      notificationsCreated: created,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return created;
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
    const notificationRef = db
      .collection('notifications')
      .doc(buildStatusPublishedNotificationId(uid));

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

      tx.set(notificationRef, {
        userId: uid,
        type: 'user_intent_status.published',
        title: 'Status publicado',
        body: buildStatusPublishedNotificationBody(destination),
        statusId,
        destinationKind: destination.kind,
        destinationVenueId: destination.venueId,
        route: '/descobrir',
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    try {
      await notifyCompatibleStatusSubscribers({
        actorUid: uid,
        statusId,
        destination,
        visibility,
      });
    } catch (error) {
      console.warn('[publishUserIntentStatus] compatible notifications skipped', error);
    }

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
