// functions/src/chat/rooms/application/create-private-room.handler.ts
// -----------------------------------------------------------------------------
// CREATE PRIVATE ROOM HANDLER
// -----------------------------------------------------------------------------
// Criação transacional de sala privada com entitlement e local moderado opcional.
// O cliente nunca define snapshots canônicos do estabelecimento.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { db, FieldValue } from '../../../firebaseApp';
import type {
  EntitlementDoc,
  PlatformRole,
} from '../../../payments/domain/billing.model';
import {
  assertMessagingAccountOperational,
} from '../../shared/messaging-account.policy';
import type {
  MessagingUserDoc,
} from '../../shared/messaging.types';
import {
  PRIVATE_ROOM_POLICY_VERSION,
  resolvePrivateRoomCreationCapabilities,
} from '../domain/room-capability-policy';

const ROOM_VENUE_INTENT_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

interface CreatePrivateRoomRequest {
  roomName?: unknown;
  description?: unknown;
  placeIntent?: unknown;
}

interface RoomPlaceIntentRequest {
  venueId: string;
  mode: 'now' | 'scheduled';
  startsAt: number;
}

interface RoomPlaceIntentPayload {
  venueId: string;
  mode: 'now' | 'scheduled';
  visibility: 'room_members';
  region: {
    uf: string;
    city: string;
  };
  label: string;
  venueKind: string | null;
  addressHint: string | null;
  startsAt: number;
  endsAt: number;
  source: 'venue_catalog';
}

interface CreatePrivateRoomResponse {
  roomId: string;
  roomName: string;
  description: string | null;
  createdBy: string;
  memberCount: number;
  visibility: 'hidden';
  roomType: 'private';
  status: 'active';
  placeIntent?: RoomPlaceIntentPayload | null;
}

type PlatformEntitlementData = Partial<EntitlementDoc> & {
  buyerUid?: unknown;
  scope?: unknown;
  active?: unknown;
  grantedRole?: unknown;
  endsAt?: unknown;
};

interface VenueDocument {
  name?: unknown;
  kind?: unknown;
  addressHint?: unknown;
  region?: {
    uf?: unknown;
    city?: unknown;
  };
  visibility?: unknown;
  moderation?: {
    state?: unknown;
  };
  chat?: {
    enabled?: unknown;
  };
}

function normalizeRoomName(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDescription(value: unknown): string | null {
  const normalized = String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();

  return normalized || null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isPlatformRole(value: unknown): value is PlatformRole {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

function assertValidInput(
  data: CreatePrivateRoomRequest | undefined
): {
  roomName: string;
  description: string | null;
  placeIntentRaw: unknown;
} {
  const roomName = normalizeRoomName(data?.roomName);
  const description = normalizeDescription(data?.description);

  if (roomName.length < 3 || roomName.length > 60) {
    throw new HttpsError(
      'invalid-argument',
      'O nome da sala deve ter entre 3 e 60 caracteres.'
    );
  }

  if (description && description.length > 280) {
    throw new HttpsError(
      'invalid-argument',
      'A descrição da sala deve ter no máximo 280 caracteres.'
    );
  }

  return {
    roomName,
    description,
    placeIntentRaw: data?.placeIntent ?? null,
  };
}

function resolveActiveSubscriptionRole(
  entitlement: PlatformEntitlementData | undefined,
  uid: string,
  now: number
): PlatformRole {
  const endsAt =
    typeof entitlement?.endsAt === 'number' && Number.isFinite(entitlement.endsAt)
      ? entitlement.endsAt
      : null;

  const isValid =
    entitlement?.active === true &&
    entitlement?.buyerUid === uid &&
    entitlement?.scope === 'platform_subscription' &&
    isPlatformRole(entitlement?.grantedRole) &&
    (endsAt === null || endsAt > now);

  if (!isValid) {
    throw new HttpsError(
      'permission-denied',
      'Seu plano atual não permite criar salas.'
    );
  }

  return entitlement.grantedRole as PlatformRole;
}

function normalizePlaceIntentRequest(
  raw: unknown,
  now: number
): RoomPlaceIntentRequest | null {
  if (raw == null) {
    return null;
  }

  if (typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', 'Estabelecimento da sala inválido.');
  }

  const source = raw as {
    venueId?: unknown;
    mode?: unknown;
    startsAt?: unknown;
  };
  const venueId = normalizeText(source.venueId);
  const mode = source.mode === 'scheduled' ? 'scheduled' : 'now';
  const startsAt =
    mode === 'now'
      ? now
      : typeof source.startsAt === 'number' && Number.isFinite(source.startsAt)
        ? Math.trunc(source.startsAt)
        : 0;

  if (!/^[A-Za-z0-9_-]{3,120}$/.test(venueId)) {
    throw new HttpsError('invalid-argument', 'Estabelecimento da sala inválido.');
  }

  if (
    mode === 'scheduled' &&
    (startsAt < now - 5 * 60 * 1000 || startsAt > now + MAX_SCHEDULE_AHEAD_MS)
  ) {
    throw new HttpsError('invalid-argument', 'Horário da sala inválido.');
  }

  return { venueId, mode, startsAt };
}

function resolveVenuePlaceIntent(
  venueId: string,
  venue: VenueDocument | undefined,
  request: RoomPlaceIntentRequest
): RoomPlaceIntentPayload {
  if (!venue) {
    throw new HttpsError('not-found', 'Estabelecimento não encontrado.');
  }

  if (
    venue.moderation?.state !== 'active' ||
    (venue.visibility !== 'public' && venue.visibility !== 'members_only') ||
    venue.chat?.enabled !== true
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Estabelecimento indisponível para salas.'
    );
  }

  const label = normalizeText(venue.name);
  const uf = normalizeText(venue.region?.uf).toUpperCase();
  const city = normalizeText(venue.region?.city).toLowerCase();

  if (label.length < 2 || label.length > 80) {
    throw new HttpsError(
      'failed-precondition',
      'Estabelecimento sem nome válido.'
    );
  }

  if (!/^[A-Z]{2}$/.test(uf) || city.length < 1 || city.length > 80) {
    throw new HttpsError(
      'failed-precondition',
      'Estabelecimento sem região válida.'
    );
  }

  return {
    venueId,
    mode: request.mode,
    visibility: 'room_members',
    region: { uf, city },
    label,
    venueKind: normalizeOptionalText(venue.kind, 40),
    addressHint: normalizeOptionalText(venue.addressHint, 160),
    startsAt: request.startsAt,
    endsAt: request.startsAt + ROOM_VENUE_INTENT_DURATION_MS,
    source: 'venue_catalog',
  };
}

export const createPrivateRoom = onCall<CreatePrivateRoomRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CreatePrivateRoomResponse> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de criar uma sala.'
      );
    }

    const input = assertValidInput(request.data);
    const now = Date.now();
    const requestedPlaceIntent = normalizePlaceIntentRequest(
      input.placeIntentRaw,
      now
    );
    let createdPlaceIntent: RoomPlaceIntentPayload | null = null;

    const userRef = db.collection('users').doc(uid);
    const entitlementRef = db
      .collection('entitlements')
      .doc(`platform_subscription_${uid}`);
    const ownerSlotRef = db.collection('room_owner_slots').doc(uid);
    const roomRef = db.collection('rooms').doc();
    const memberRef = roomRef.collection('members').doc(uid);
    const auditRef = db.collection('room_audit').doc();

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const [userSnapshot, entitlementSnapshot, ownerSlotSnapshot] =
        await Promise.all([
          tx.get(userRef),
          tx.get(entitlementRef),
          tx.get(ownerSlotRef),
        ]);

      const user = userSnapshot.data() as MessagingUserDoc | undefined;

      assertMessagingAccountOperational(user, {
        operation: 'create-private-room',
        perspective: 'actor',
      });

      const entitlement = entitlementSnapshot.data() as
        | PlatformEntitlementData
        | undefined;
      const grantedRole = resolveActiveSubscriptionRole(
        entitlement,
        uid,
        now
      );
      const capabilities =
        resolvePrivateRoomCreationCapabilities(grantedRole);

      if (!capabilities.canCreatePrivateRoom) {
        throw new HttpsError(
          'permission-denied',
          'Seu plano atual não permite criar salas.'
        );
      }

      if (requestedPlaceIntent && !capabilities.canUseVenueIntent) {
        throw new HttpsError(
          'permission-denied',
          'Estabelecimento da sala é exclusivo para plano premium ou superior.'
        );
      }

      if (requestedPlaceIntent) {
        const venueRef = db
          .collection('venues')
          .doc(requestedPlaceIntent.venueId);
        const venueSnapshot = await tx.get(venueRef);

        createdPlaceIntent = resolveVenuePlaceIntent(
          venueSnapshot.id,
          venueSnapshot.data() as VenueDocument | undefined,
          requestedPlaceIntent
        );
      }

      const activeSlot = ownerSlotSnapshot.data() as
        | { active?: boolean; roomId?: string | null }
        | undefined;

      if (activeSlot?.active === true) {
        throw new HttpsError(
          'failed-precondition',
          'Você já atingiu o limite de salas criadas.'
        );
      }

      const legacyOwnedRoomsQuery = db
        .collection('rooms')
        .where('createdBy', '==', uid)
        .limit(capabilities.maxOwnedActiveRooms);
      const legacyOwnedRoomsSnapshot = await tx.get(legacyOwnedRoomsQuery);

      if (!legacyOwnedRoomsSnapshot.empty) {
        throw new HttpsError(
          'failed-precondition',
          'Você já atingiu o limite de salas criadas.'
        );
      }

      tx.set(roomRef, {
        roomName: input.roomName,
        description: input.description,
        createdBy: uid,

        // Compatibilidade temporária com as consultas atuais do frontend.
        participants: [uid],
        memberCount: 1,
        membershipMode: 'invite_only',

        isRoom: true,
        isPrivate: true,
        roomType: 'private',
        visibility: 'hidden',
        status: 'active',

        ...(createdPlaceIntent
          ? {
              placeIntent: {
                ...createdPlaceIntent,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              },
            }
          : {}),

        policyVersion: PRIVATE_ROOM_POLICY_VERSION,
        entitlementRoleAtCreation: grantedRole,
        creationTime: FieldValue.serverTimestamp(),
        lastActivity: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(memberRef, {
        uid,
        membershipRole: 'owner',
        status: 'active',
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(ownerSlotRef, {
        uid,
        roomId: roomRef.id,
        active: true,
        maxOwnedActiveRooms: capabilities.maxOwnedActiveRooms,
        entitlementRoleAtCreation: grantedRole,
        policyVersion: PRIVATE_ROOM_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(auditRef, {
        action: 'create_private_room',
        actorUid: uid,
        roomId: roomRef.id,
        entitlementRole: grantedRole,
        hasPlaceIntent: createdPlaceIntent !== null,
        placeIntentVenueId: createdPlaceIntent?.venueId ?? null,
        placeIntentRegion: createdPlaceIntent?.region ?? null,
        policyVersion: PRIVATE_ROOM_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      roomId: roomRef.id,
      roomName: input.roomName,
      description: input.description,
      createdBy: uid,
      memberCount: 1,
      visibility: 'hidden',
      roomType: 'private',
      status: 'active',
      placeIntent: createdPlaceIntent,
    };
  }
);
