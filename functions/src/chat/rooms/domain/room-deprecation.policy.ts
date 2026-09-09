import { HttpsError } from 'firebase-functions/v2/https';

export const ROOM_PRODUCT_STATE = 'deprecated_compatibility_only' as const;

export const ROOM_DEPRECATION_USER_MESSAGE =
  'As Salas foram descontinuadas. Use Comunidades para interações coletivas.';

export type DeprecatedRoomGrowthOperation =
  | 'create_room'
  | 'send_invite'
  | 'accept_invite';

/**
 * Salas permanecem apenas para leitura histórica e saneamento.
 *
 * Operações deliberadamente preservadas fora desta função:
 * - close_room: owner pode encerrar uma Sala legada;
 * - decline_invite: destinatário pode limpar um convite legado.
 */
export function rejectDeprecatedRoomGrowth(
  _operation: DeprecatedRoomGrowthOperation
): never {
  void _operation;

  throw new HttpsError(
    'failed-precondition',
    ROOM_DEPRECATION_USER_MESSAGE,
    {
      productState: ROOM_PRODUCT_STATE,
      canonicalCollectiveDomain: 'community',
    }
  );
}
