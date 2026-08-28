// functions\src\chat\rooms\application\close-private-room.handler.ts
// -----------------------------------------------------------------------------
// CLOSE PRIVATE ROOM HANDLER
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - encerrar logicamente uma sala privada criada pelo usuário autenticado;
// - liberar room_owner_slots/{uid} para permitir nova sala futura;
// - manter histórico/auditoria sem apagar documento;
// - impedir que cliente comum altere status/slot diretamente.
//
// Segurança:
// - somente o owner pode encerrar a própria sala;
// - a sala precisa estar ativa;
// - o slot precisa apontar para a sala informada;
// - o backend grava status, timestamps e auditoria.
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';
import {
  assertMessagingAccountOperational,
} from '../../shared/messaging-account.policy';
import type {
  MessagingUserDoc,
} from '../../shared/messaging.types';
import { PRIVATE_ROOM_POLICY_VERSION } from '../domain/room-capability-policy';

interface ClosePrivateRoomRequest {
  roomId?: unknown;
}

interface ClosePrivateRoomResponse {
  roomId: string;
  status: 'closed';
  slotReleased: boolean;
}

function normalizeRoomId(value: unknown): string {
  return String(value ?? '').trim();
}

export const closePrivateRoom = onCall<ClosePrivateRoomRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ClosePrivateRoomResponse> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const roomId = normalizeRoomId(request.data?.roomId);

    if (!roomId) {
      throw new HttpsError('invalid-argument', 'roomId ausente.');
    }

    const userRef = db.collection('users').doc(uid);
    const roomRef = db.collection('rooms').doc(roomId);
    const ownerSlotRef = db.collection('room_owner_slots').doc(uid);
    const auditRef = db.collection('room_audit').doc();

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const [userSnapshot, roomSnapshot, ownerSlotSnapshot] = await Promise.all([
        tx.get(userRef),
        tx.get(roomRef),
        tx.get(ownerSlotRef),
      ]);

      const user = userSnapshot.data() as MessagingUserDoc | undefined;

      assertMessagingAccountOperational(user, {
        operation: 'close-private-room',
        perspective: 'actor',
      });

      if (!roomSnapshot.exists) {
        throw new HttpsError('not-found', 'Sala não encontrada.');
      }

      const room = roomSnapshot.data() as {
        createdBy?: unknown;
        status?: unknown;
        roomType?: unknown;
      };

      if (room.createdBy !== uid) {
        throw new HttpsError(
          'permission-denied',
          'Você não pode encerrar esta sala.'
        );
      }

      if (room.roomType !== 'private') {
        throw new HttpsError(
          'failed-precondition',
          'Apenas salas privadas podem ser encerradas por este fluxo.'
        );
      }

      if (room.status === 'closed' || room.status === 'archived') {
        throw new HttpsError(
          'failed-precondition',
          'Esta sala já foi encerrada.'
        );
      }

      const ownerSlot = ownerSlotSnapshot.data() as
        | { active?: boolean; roomId?: string | null }
        | undefined;

      if (ownerSlot?.active === true && ownerSlot.roomId !== roomId) {
        throw new HttpsError(
          'failed-precondition',
          'O slot ativo não pertence à sala informada.'
        );
      }

      tx.update(roomRef, {
        status: 'closed',
        closedAt: FieldValue.serverTimestamp(),
        closedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
        lastActivity: FieldValue.serverTimestamp(),
      });

      tx.set(
        ownerSlotRef,
        {
          uid,
          roomId,
          active: false,
          releasedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(auditRef, {
        action: 'close_private_room',
        actorUid: uid,
        roomId,
        policyVersion: PRIVATE_ROOM_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      roomId,
      status: 'closed',
      slotReleased: true,
    };
  }
);
