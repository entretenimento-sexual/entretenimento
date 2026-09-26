// functions/src/account_lifecycle/account-deletion-owned-resources.service.ts
// -----------------------------------------------------------------------------
// ACCOUNT DELETION OWNED RESOURCES SERVICE
// -----------------------------------------------------------------------------
// Revalida ownership canônico na mesma transação que agenda a exclusão.
// A exclusão nunca pode depender de projeções client-side nem deixar recursos
// com owner operacional inexistente após o purge.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
import {
  type AccountDeletionOwnedResourcesDecision,
  evaluateAccountDeletionOwnedResources,
} from './account-deletion-owned-resources.policy';

const TERMINAL_ROOM_STATUSES = new Set(['closed', 'archived']);

function normalizeRoomStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export async function inspectAccountDeletionOwnedResourcesInTransaction(
  transaction: FirebaseFirestore.Transaction,
  uid: string
): Promise<Readonly<AccountDeletionOwnedResourcesDecision>> {
  const ownerSlotRef = db.collection('room_owner_slots').doc(uid);
  const ownedRoomsQuery = db
    .collection('rooms')
    .where('createdBy', '==', uid);
  const ownedCommunitiesQuery = db
    .collection('communities')
    .where('ownerUid', '==', uid);

  const [
    ownerSlotSnapshot,
    ownedRoomsSnapshot,
    ownedCommunitiesSnapshot,
  ] = await Promise.all([
    transaction.get(ownerSlotRef),
    transaction.get(ownedRoomsQuery),
    transaction.get(ownedCommunitiesQuery),
  ]);

  const ownedRoomStatuses = ownedRoomsSnapshot.docs.map(
    (documentSnapshot) => ({
      roomId: documentSnapshot.id,
      status: normalizeRoomStatus(documentSnapshot.data()?.['status']),
    })
  );
  const ownerSlot = ownerSlotSnapshot.data() ?? {};
  const ownerSlotRoomId = String(ownerSlot['roomId'] ?? '').trim();
  const ownerSlotRoom = ownedRoomStatuses.find(
    (room) => room.roomId === ownerSlotRoomId
  );
  const activeOwnerSlot =
    ownerSlot['active'] === true
    && !!ownerSlotRoom
    && !TERMINAL_ROOM_STATUSES.has(ownerSlotRoom.status);

  // ownerUid é o ponteiro canônico. Um documento que ainda aponta para a conta
  // continua sendo responsabilidade dela, mesmo se uma membership derivada
  // estiver ausente ou inconsistente.
  const ownedCommunityCount = ownedCommunitiesSnapshot.docs.filter(
    (documentSnapshot) => {
      const community = documentSnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const status = String(community['status'] ?? '').trim().toLowerCase();

      return source['type'] === 'community' && status !== 'archived';
    }
  ).length;

  return evaluateAccountDeletionOwnedResources({
    ownedRoomStatuses: ownedRoomStatuses.map((room) => room.status),
    activeOwnerSlot,
    ownedCommunityCount,
  });
}

export function assertAccountDeletionOwnedResourcesResolved(
  decision: Readonly<AccountDeletionOwnedResourcesDecision>
): void {
  if (decision.allowed) return;

  throw new HttpsError(
    'failed-precondition',
    'Resolva os espaços sob responsabilidade da conta antes de excluir.',
    {
      reason: 'owned-resources-require-resolution',
      activeOwnedRoomCount: decision.activeOwnedRoomCount,
      ownedCommunityCount: decision.ownedCommunityCount,
      recommendedAction: 'resolve-owned-spaces',
    }
  );
}
