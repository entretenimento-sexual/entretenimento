// functions/src/chat/rooms/application/respond-room-invite.handler.ts
// -----------------------------------------------------------------------------
// ROOM INVITE RESPONSE — LEGACY COMPATIBILITY
// -----------------------------------------------------------------------------
//
// SUPRESSÃO EXPLÍCITA:
// - aceitar convite e criar membership/participants/user.roomIds foi removido;
// - motivo: Salas não recebem novos participantes durante a depreciação;
// - recusar permanece disponível para o destinatário limpar convites antigos.
// -----------------------------------------------------------------------------

import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { db, FieldValue } from '../../../firebaseApp';
import { assertMessagingAccountOperational } from '../../shared/messaging-account.policy';
import type { MessagingUserDoc } from '../../shared/messaging.types';
import { rejectDeprecatedRoomGrowth } from '../domain/room-deprecation.policy';

interface RoomInviteResponseRequest {
  inviteId?: unknown;
}

interface RoomInviteResponseResult {
  inviteId: string;
  roomId: string;
  status: 'declined';
  deduplicated: boolean;
}

interface RoomInviteDocument {
  type?: unknown;
  targetId?: unknown;
  roomId?: unknown;
  receiverId?: unknown;
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

async function declineLegacyRoomInvite(
  request: CallableRequest<RoomInviteResponseRequest>
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

  return db.runTransaction(async (tx): Promise<RoomInviteResponseResult> => {
    const [userSnapshot, inviteSnapshot] = await Promise.all([
      tx.get(userRef),
      tx.get(inviteRef),
    ]);

    const user = userSnapshot.data() as MessagingUserDoc | undefined;
    assertMessagingAccountOperational(user, {
      operation: 'decline-room-invite',
      perspective: 'actor',
    });

    const invite = inviteSnapshot.data() as RoomInviteDocument | undefined;

    if (!inviteSnapshot.exists || !invite) {
      throw new HttpsError('not-found', 'Convite não encontrado.');
    }

    if (normalizeText(invite.receiverId) !== uid) {
      throw new HttpsError(
        'permission-denied',
        'Este convite não pertence à sua conta.'
      );
    }

    if (normalizeText(invite.type || 'room') !== 'room') {
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

    if (invite.status === 'declined') {
      return {
        inviteId,
        roomId,
        status: 'declined',
        deduplicated: true,
      };
    }

    if (invite.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        'Este convite não está mais pendente.'
      );
    }

    tx.update(inviteRef, {
      status: 'declined',
      respondedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(auditRef, {
      action: 'decline_room_invite_during_deprecation',
      actorUid: uid,
      roomId,
      inviteId,
      source: 'legacy_cleanup',
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      inviteId,
      roomId,
      status: 'declined',
      deduplicated: false,
    };
  });
}

export const acceptRoomInvite = onCall<RoomInviteResponseRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<never> => {
    const uid = normalizeText(request.auth?.uid);

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    rejectDeprecatedRoomGrowth('accept_invite');
  }
);

export const declineRoomInvite = onCall<RoomInviteResponseRequest>(
  { region: FUNCTIONS_REGION },
  declineLegacyRoomInvite
);
