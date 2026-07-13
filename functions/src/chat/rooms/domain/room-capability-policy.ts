// functions/src/chat/rooms/domain/room-capability-policy.ts
// -----------------------------------------------------------------------------
// ROOM CAPABILITY POLICY
// -----------------------------------------------------------------------------
// Centraliza decisões de produto e autorização derivadas do entitlement válido.
import type { PlatformRole } from '../../../payments/domain/billing.model';

export const PRIVATE_ROOM_POLICY_VERSION = 'private-room-v2' as const;

export interface PrivateRoomCreationCapabilities {
  canCreatePrivateRoom: boolean;
  canUseVenueIntent: boolean;
  maxOwnedActiveRooms: number;
}

const PRIVATE_ROOM_CREATION_CAPABILITIES: Record<
  PlatformRole,
  PrivateRoomCreationCapabilities
> = {
  basic: {
    canCreatePrivateRoom: true,
    canUseVenueIntent: false,
    maxOwnedActiveRooms: 1,
  },
  premium: {
    canCreatePrivateRoom: true,
    canUseVenueIntent: true,
    maxOwnedActiveRooms: 1,
  },
  vip: {
    canCreatePrivateRoom: true,
    canUseVenueIntent: true,
    maxOwnedActiveRooms: 1,
  },
};

export function resolvePrivateRoomCreationCapabilities(
  role: PlatformRole
): PrivateRoomCreationCapabilities {
  return PRIVATE_ROOM_CREATION_CAPABILITIES[role];
}
