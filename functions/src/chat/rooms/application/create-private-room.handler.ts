// functions/src/chat/rooms/application/create-private-room.handler.ts
// -----------------------------------------------------------------------------
// CREATE PRIVATE ROOM HANDLER — LEGACY COMPATIBILITY
// -----------------------------------------------------------------------------
//
// SUPRESSÃO EXPLÍCITA:
// - foi removida a implementação de criação de Sala privada, incluindo
//   entitlement, placeIntent, owner slot, membership e gravações transacionais;
// - motivo: Salas deixaram de ser produto independente. Manter a implementação
//   ativa permitiria que clientes antigos continuassem criando dívida legada.
// - o histórico permanece no Git e os documentos existentes não são apagados.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { rejectDeprecatedRoomGrowth } from '../domain/room-deprecation.policy';

export const createPrivateRoom = onCall<unknown>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<never> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    rejectDeprecatedRoomGrowth('create_room');
  }
);
