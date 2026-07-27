// functions/src/chat/rooms/application/respond-room-invite.handler.ts
// -----------------------------------------------------------------------------
// RESPOND ROOM INVITE HANDLERS
// -----------------------------------------------------------------------------
// Autoridade backend para aceitar/recusar convites de sala.
// O cliente envia somente inviteId; UID, roomId e membership são resolvidos aqui.
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { db, FieldValue, Timestamp } from '../../../firebaseApp';
import { assertMessagingAccountOperational } from '../../shared/messaging-account.policy';
import type { MessagingUserDoc } from '../../shared/messaging.types';

interface RoomInviteResponseRequest {
  inviteId?: unknown;
}

type RoomInviteDecision = 'accepted' | 'declined';

interface RoomInviteResponseResult {
  inviteId: string;
  roomId: string;
  status: RoomInviteDecision;
  deduplicated: boolean;
}

interface RoomInviteDocument {
  type?: unknown;
  targetId?: unknown;
  roomId?: unknown;
  senderId?: unknown;
  receiverId?: unknown;
  status?: unknown;
  expiresAt?: unknown;
}

interface RoomDocument {
  participants?: unknown;
  status?: unknown;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function requireInviteId(value: unknown): string {
  const inviteId = normalizeText(value);

  if (!/^room:[^:]{1,160}:to:[^:]{1,160}$/.test(inviteId)) {
    throw new HttpsError('invalid-argument', 'Convite de sala inválido.');
  }

  return inviteId;
}

function resolveRoomId(invite: RoomInviteDocument): string {
  const roomId = normalizeText(invite.targetId ?? invite.roomId);

  if (!roomId) {
    throw new HttpsError('failed-precondition', 'Convite sem sala válida.');
  }

  return roomId;
}

function toEpochMs(value: unknown): number | null {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    toMillis?: () => number;
    seconds?: unknown;
    nanoseconds?: unknown;
  };

  if (typeof candidate.toMillis === 'function') {
    const millis = candidate.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof candidate.seconds === 'number') {
    const nanoseconds =
      typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : 0;
    return candidate.seconds * 1000 + nanoseconds / 1_000_000;
  }

  return null;
}

function normalizeParticipants(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => normalizeText(item))
        .filter((item) => item.length > 0)
    )
  );
}

function assertInviteOwnershipAndShape(
  inviteId: string,
  invite: RoomInviteDocument | undefined,
  uid: string,
  now: number,
  decision: RoomInviteDecision
): { roomId: string; deduplicated: boolean } {
  if (!invite) {
    throw new HttpsError('not-found', 'Convite não encontrado.');
  }

  if (normalizeText(invite.receiverId) !== uid) {
    throw new HttpsError(
      'permission-denied',
      'Este convite não pertence à sua conta.'
    );
  }

  const inviteType = normalizeText(invite.type || 'room');
  if (inviteType !== 'room') {
    throw new HttpsError('failed-precondition', 'Convite não é de uma sala.');
  }

  const roomId = resolveRoomId(invite);
  const expectedInviteId = `room:${roomId}:to:${uid}`;

  if (inviteId !== expectedInviteId) {
    throw new HttpsError(
      'failed-precondition',
      'Convite fora do contrato canônico.'
    );
  }

  if (invite.status === decision) {
    return { roomId, deduplicated: true };
  }

  if (invite.status !== 'pending') {
    throw new HttpsError(
      'failed-precondition',
      'Este convite não está mais pendente.'
    );
  }

  const expiresAt = toEpochMs(invite.expiresAt);
  if (expiresAt === null || expiresAt <= now) {
    throw new HttpsError('failed-precondition', 'Este convite expirou.');
  }

  return { roomId, deduplicated: false };
}

async function respondRoomInvite(
  request: CallableRequest<RoomInviteResponseRequest>,
  decision: RoomInviteDecision
): Promise<RoomInviteResponseResult> {
  const uid = normalizeText(request.auth?.uid);

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail antes de responder a convites.'
    );
  }

  const inviteId = requireInviteId(request.data?.inviteId);
  const userRef = db.collection('users').doc(uid);
  const inviteRef = db.collection('invites').doc(inviteId);
  const auditRef = db.collection('room_audit').doc();
  const now = Date.now();

  return db.runTransaction(async (tx): Promise<RoomInviteResponseResult> => {
    const [userSnapshot, inviteSnapshot] = await Promise.all([
      tx.get(userRef),
      tx.get(inviteRef),
    ]);

    const user = userSnapshot.data() as MessagingUserDoc | undefined;
    assertMessagingAccountOperational(user, {
      operation:
        decision === 'accepted'
          ? 'accept-room-invite'
          : 'decline-room-invite',
      perspective: 'actor',
    });

    const invite = inviteSnapshot.data() as RoomInviteDocument | undefined;
    const validation = assertInviteOwnershipAndShape(
      inviteId,
      invite,
      uid,
      now,
      decision
    );

    if (validation.deduplicated) {
      return {
        inviteId,
        roomId: validation.roomId,
        status: decision,
        deduplicated: true,
      };
    }

    const roomId = validation.roomId;

    if (decision === 'accepted') {
      const roomRef = db.collection('rooms').doc(roomId);
      const memberRef = roomRef.collection('members').doc(uid);
      const roomSnapshot = await tx.get(roomRef);

      if (!roomSnapshot.exists) {
        throw new HttpsError('not-found', 'Sala não encontrada.');
      }

      const room = roomSnapshot.data() as RoomDocument | undefined;
      if (normalizeText(room?.status || 'active') !== 'active') {
        throw new HttpsError('failed-precondition', 'Esta sala não está ativa.');
      }

      const participants = normalizeParticipants(room?.participants);
      const nextParticipants = participants.includes(uid)
        ? participants
        : [...participants, uid];

      tx.update(roomRef, {
        participants: nextParticipants,
        memberCount: nextParticipants.length,
        lastActivity: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(
        memberRef,
        {
          uid,
          membershipRole: 'member',
          status: 'active',
          joinedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        userRef,
        {
          roomIds: FieldValue.arrayUnion(roomId),
        },
        { merge: true }
      );
    }

    tx.update(inviteRef, {
      status: decision,
      respondedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(auditRef, {
      action:
        decision === 'accepted'
          ? 'accept_room_invite'
          : 'decline_room_invite',
      actorUid: uid,
      roomId,
      inviteId,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      inviteId,
      roomId,
      status: decision,
      deduplicated: false,
    };
  });
}

export const acceptRoomInvite = onCall<RoomInviteResponseRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => respondRoomInvite(request, 'accepted')
);

export const declineRoomInvite = onCall<RoomInviteResponseRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => respondRoomInvite(request, 'declined')
);
