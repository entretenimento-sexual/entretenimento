// functions/src/account_lifecycle/account-deletion-owned-resources.policy.ts
// -----------------------------------------------------------------------------
// OWNED RESOURCE PRECONDITIONS FOR SELF DELETION
// -----------------------------------------------------------------------------
// Evita colocar a conta em pending_deletion quando ainda existem recursos que
// só o usuário operacional consegue encerrar ou transferir.
// -----------------------------------------------------------------------------

const TERMINAL_ROOM_STATUSES = new Set(['closed', 'archived']);

export interface AccountDeletionOwnedResourcesInput {
  ownedRoomStatuses?: readonly unknown[];
  activeOwnerSlot?: unknown;
  ownedCommunityCount?: unknown;
}

export interface AccountDeletionOwnedResourcesDecision {
  allowed: boolean;
  activeOwnedRoomCount: number;
  ownedCommunityCount: number;
}

export function evaluateAccountDeletionOwnedResources(
  input: AccountDeletionOwnedResourcesInput
): AccountDeletionOwnedResourcesDecision {
  const activeRoomsFromDocuments = (input.ownedRoomStatuses ?? []).filter(
    (status) => !TERMINAL_ROOM_STATUSES.has(normalizeStatus(status))
  ).length;
  const activeOwnerSlot = input.activeOwnerSlot === true ? 1 : 0;
  const activeOwnedRoomCount = Math.max(
    activeRoomsFromDocuments,
    activeOwnerSlot
  );
  const ownedCommunityCount = normalizeNonNegativeInteger(
    input.ownedCommunityCount
  );

  return {
    allowed: activeOwnedRoomCount === 0 && ownedCommunityCount === 0,
    activeOwnedRoomCount,
    ownedCommunityCount,
  };
}

function normalizeStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}
