// functions/src/rooms/domain/room-capability-policy.ts
// -----------------------------------------------------------------------------
// ROOM CAPABILITY POLICY
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - concentrar decisões de produto sobre quem pode criar salas;
// - evitar espalhar verificações de role/plano por handlers diferentes;
// - permitir evolução futura para capacidades mais específicas.
//
// Decisão inicial:
// - somente assinatura ativa da plataforma autoriza criação;
// - basic, premium e vip podem criar sala privada;
// - nesta primeira fase, todos possuem limite de 1 sala ativa própria;
// - participação, convites e quantidade de membros serão tratados em handlers
//   específicos, sem liberar mutações diretas pelo cliente.

import type { PlatformRole } from '../../payments/domain/billing.model';

export const PRIVATE_ROOM_POLICY_VERSION = 'private-room-v1' as const;

export interface PrivateRoomCreationCapabilities {
  canCreatePrivateRoom: boolean;
  maxOwnedActiveRooms: number;
}

const PRIVATE_ROOM_CREATION_CAPABILITIES: Record<
  PlatformRole,
  PrivateRoomCreationCapabilities
> = {
  basic: {
    canCreatePrivateRoom: true,
    maxOwnedActiveRooms: 1,
  },
  premium: {
    canCreatePrivateRoom: true,
    maxOwnedActiveRooms: 1,
  },
  vip: {
    canCreatePrivateRoom: true,
    maxOwnedActiveRooms: 1,
  },
};

export function resolvePrivateRoomCreationCapabilities(
  role: PlatformRole
): PrivateRoomCreationCapabilities {
  return PRIVATE_ROOM_CREATION_CAPABILITIES[role];
}