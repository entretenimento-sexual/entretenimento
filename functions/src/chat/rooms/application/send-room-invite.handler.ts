// functions/src/chat/rooms/application/send-room-invite.handler.ts
// -----------------------------------------------------------------------------
// SEND ROOM INVITE HANDLER
// -----------------------------------------------------------------------------
// Autoridade backend para criar convites de sala privada.
//
// O cliente informa somente roomId e receiverId. O backend resolve e valida:
// - remetente autenticado e conta operacional;
// - autoridade do remetente na sala;
// - sala ativa;
// - destinatário elegível e ainda não participante;
// - bloqueios bilaterais;
// - convite canônico, expiração, notificação e auditoria.
// -----------------------------------------------------------------------------
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { db, FieldValue, Timestamp } from '../../../firebaseApp';
import { assertMessagingAccountOperational } from '../../shared/messaging-account.policy';
import type { MessagingUserDoc } from '../../shared/messaging.types';

interface SendRoomInviteRequest {
  roomId?: unknown;
  receiverId?: unknown;
}

interface SendRoomInviteResult {
  inviteId: string;
  roomId: string;
  receiverId: string;
  status: 'pending';
  deduplicated: boolean;
}

interface RoomDocument {
  roomName?: unknown;
  createdBy?: unknown;
  participants?: unknown;
  status?: unknown;
}

interface RoomMemberDocument {
  membershipRole?: unknown;
  status?: unknown;
}

interface RoomInviteDocument {
  status?: unknown;
  expiresAt?: unknown;
}

interface PreferencesDocument {
  notificationPreferences?: {
    rooms?: unknown;
  };
}

const ROOM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_POLICY_VERSION = 'room-invite-v1';

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeDisplayText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function requireCanonicalPart(value: unknown, message: string): string {
  const normalized = normalizeText(value);

  if (!normalized || normalized.length > 160 || normalized.includes(':')) {
    throw new HttpsError('invalid-argument', message);
  }

  return normalized;
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

function isActiveBlock(
  data: FirebaseFirestore.DocumentData | undefined
): boolean {
  return data?.['isBlocked'] === true;
}

function allowsRoomNotifications(
  preferences: PreferencesDocument | undefined
): boolean {
  return preferences?.notificationPreferences?.rooms !== false;
}

function assertActorCanInvite(
  room: RoomDocument | undefined,
  actorMembership: RoomMemberDocument | undefined,
  actorUid: string
): void {
  if (!room) {
    throw new HttpsError('not-found', 'Sala não encontrada.');
  }

  if (normalizeText(room.status || 'active') !== 'active') {
    throw new HttpsError('failed-precondition', 'Esta sala não está ativa.');
  }

  const isCreator = normalizeText(room.createdBy) === actorUid;
  const membershipStatus = normalizeText(actorMembership?.status);
  const membershipRole = normalizeText(actorMembership?.membershipRole);
  const hasManagementRole =
    membershipStatus === 'active' &&
    ['owner', 'admin', 'moderator'].includes(membershipRole);

  if (!isCreator && !hasManagementRole) {
    throw new HttpsError(
      'permission-denied',
      'Somente a gestão da sala pode enviar convites.'
    );
  }
}

function buildInviteId(roomId: string, receiverId: string): string {
  return `room:${roomId}:to:${receiverId}`;
}

function buildNotificationId(roomId: string, receiverId: string): string {
  return `room_invite_received_${roomId}_${receiverId}`;
}

async function handleSendRoomInvite(
  request: CallableRequest<SendRoomInviteRequest>
): Promise<SendRoomInviteResult> {
  const actorUid = normalizeText(request.auth?.uid);

  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail antes de enviar convites para salas.'
    );
  }

  const roomId = requireCanonicalPart(
    request.data?.roomId,
    'Sala inválida para convite.'
  );
  const receiverId = requireCanonicalPart(
    request.data?.receiverId,
    'Destinatário inválido para convite.'
  );

  if (actorUid === receiverId) {
    throw new HttpsError(
      'invalid-argument',
      'Você já participa da própria sala.'
    );
  }

  const inviteId = buildInviteId(roomId, receiverId);
  const nowMs = Date.now();

  return db.runTransaction(async (tx): Promise<SendRoomInviteResult> => {
    const actorRef = db.collection('users').doc(actorUid);
    const receiverRef = db.collection('users').doc(receiverId);
    const roomRef = db.collection('rooms').doc(roomId);
    const actorMemberRef = roomRef.collection('members').doc(actorUid);
    const receiverMemberRef = roomRef.collection('members').doc(receiverId);
    const actorBlockRef = actorRef.collection('blocks').doc(receiverId);
    const receiverBlockRef = receiverRef.collection('blocks').doc(actorUid);
    const inviteRef = db.collection('invites').doc(inviteId);
    const receiverPreferencesRef = db.collection('preferences').doc(receiverId);
    const notificationRef = db
      .collection('notifications')
      .doc(buildNotificationId(roomId, receiverId));
    const auditRef = db.collection('room_audit').doc();

    const [
      actorSnapshot,
      receiverSnapshot,
      roomSnapshot,
      actorMemberSnapshot,
      receiverMemberSnapshot,
      actorBlockSnapshot,
      receiverBlockSnapshot,
      inviteSnapshot,
      receiverPreferencesSnapshot,
    ] = await Promise.all([
      tx.get(actorRef),
      tx.get(receiverRef),
      tx.get(roomRef),
      tx.get(actorMemberRef),
      tx.get(receiverMemberRef),
      tx.get(actorBlockRef),
      tx.get(receiverBlockRef),
      tx.get(inviteRef),
      tx.get(receiverPreferencesRef),
    ]);

    const actor = actorSnapshot.data() as MessagingUserDoc | undefined;
    const receiver = receiverSnapshot.data() as MessagingUserDoc | undefined;
    const room = roomSnapshot.data() as RoomDocument | undefined;
    const actorMembership = actorMemberSnapshot.data() as
      | RoomMemberDocument
      | undefined;
    const receiverMembership = receiverMemberSnapshot.data() as
      | RoomMemberDocument
      | undefined;

    assertMessagingAccountOperational(actor, {
      operation: 'send-room-invite',
      perspective: 'actor',
    });
    assertMessagingAccountOperational(receiver, {
      operation: 'send-room-invite',
      perspective: 'target',
    });
    assertActorCanInvite(room, actorMembership, actorUid);

    if (
      isActiveBlock(actorBlockSnapshot.data()) ||
      isActiveBlock(receiverBlockSnapshot.data())
    ) {
      throw new HttpsError(
        'permission-denied',
        'Não foi possível enviar este convite.'
      );
    }

    const participants = normalizeParticipants(room?.participants);
    const receiverIsActiveMember =
      participants.includes(receiverId) ||
      normalizeText(receiverMembership?.status) === 'active';

    if (receiverIsActiveMember) {
      throw new HttpsError(
        'already-exists',
        'Este perfil já participa da sala.'
      );
    }

    const existingInvite = inviteSnapshot.data() as
      | RoomInviteDocument
      | undefined;
    const existingExpiresAt = toEpochMs(existingInvite?.expiresAt);

    if (
      inviteSnapshot.exists &&
      normalizeText(existingInvite?.status) === 'pending' &&
      existingExpiresAt !== null &&
      existingExpiresAt > nowMs
    ) {
      return {
        inviteId,
        roomId,
        receiverId,
        status: 'pending',
        deduplicated: true,
      };
    }

    const now = FieldValue.serverTimestamp();
    const expiresAt = Timestamp.fromMillis(nowMs + ROOM_INVITE_TTL_MS);
    const roomName = normalizeDisplayText(room?.roomName, 60) || 'Sala privada';
    const actorNickname =
      normalizeDisplayText(actor?.nickname, 40) || 'Um participante';
    const receiverPreferences = receiverPreferencesSnapshot.data() as
      | PreferencesDocument
      | undefined;
    const shouldNotify = allowsRoomNotifications(receiverPreferences);

    tx.set(inviteRef, {
      type: 'room',
      targetId: roomId,
      targetName: roomName,
      roomId,
      roomName,
      senderId: actorUid,
      receiverId,
      status: 'pending',
      sentAt: now,
      expiresAt,
      respondedAt: null,
      updatedAt: now,
      policyVersion: INVITE_POLICY_VERSION,
      source: 'callable',
    });

    if (shouldNotify) {
      tx.set(
        notificationRef,
        {
          userId: receiverId,
          type: 'chat',
          title: 'Convite para sala',
          body: `${actorNickname} convidou você para ${roomName}.`,
          route: '/chat/room-invites',
          inviteId,
          roomId,
          actorUid,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    tx.set(auditRef, {
      action: 'send_room_invite',
      actorUid,
      receiverId,
      roomId,
      inviteId,
      notificationSuppressed: !shouldNotify,
      policyVersion: INVITE_POLICY_VERSION,
      source: 'callable',
      createdAt: now,
    });

    return {
      inviteId,
      roomId,
      receiverId,
      status: 'pending',
      deduplicated: false,
    };
  });
}

export const sendRoomInvite = onCall<SendRoomInviteRequest>(
  { region: FUNCTIONS_REGION, invoker: 'public' },
  handleSendRoomInvite
);
