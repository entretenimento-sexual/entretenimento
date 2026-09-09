// functions/src/chat/rooms/application/send-room-invite.handler.ts
// -----------------------------------------------------------------------------
// SEND ROOM INVITE HANDLER — LEGACY COMPATIBILITY
// -----------------------------------------------------------------------------
//
// SUPRESSÃO EXPLÍCITA:
// - foi removida a criação de novos convites de Sala, inclusive notificação,
//   rate/eligibility checks e auditoria específica de envio;
// - motivo: não pode surgir nova participação em um domínio descontinuado.
// - convites já persistidos continuam disponíveis para recusa/expiração.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { rejectDeprecatedRoomGrowth } from '../domain/room-deprecation.policy';

export const sendRoomInvite = onCall<unknown>(
  { region: FUNCTIONS_REGION, invoker: 'public' },
  async (request): Promise<never> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    rejectDeprecatedRoomGrowth('send_invite');
  }
);
