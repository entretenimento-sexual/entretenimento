// functions/src/account_lifecycle/requestAccountDeletion.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  RestorableAccountStatus,
  UserDoc,
  assertRecentAuthentication,
  createLifecycleAudit,
  getNicknameIndexDocId,
  normalizeOptionalReason,
} from './_shared';
import { evaluateAccountDeletionOwnedResources } from './account-deletion-owned-resources.policy';

interface RequestAccountDeletionRequest {
  reason?: string | null;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: 'pending_deletion';
  publicVisibility: 'hidden';
  interactionBlocked: true;
  deletionRequestedAt: number;
  deletionUndoUntil: number;
  purgeAfter: number;
  statusUpdatedAt: number;
  message: string;
}

interface DeletionSchedule {
  deletionRequestedAt: number;
  deletionUndoUntil: number;
  purgeAfter: number;
  statusUpdatedAt: number;
}

const DEFAULT_UNDO_WINDOW_MS = 24 * 60 * 60 * 1_000;
const TERMINAL_ROOM_STATUSES = new Set(['closed', 'archived']);

function normalizeRestorableStatus(value: unknown): RestorableAccountStatus {
  return value === 'self_suspended' || value === 'moderation_suspended'
    ? value
    : 'active';
}

function normalizeRoomStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function countOwnedCommunityMemberships(
  snapshot: FirebaseFirestore.QuerySnapshot,
  uid: string
): number {
  return snapshot.docs.filter((documentSnapshot) => {
    const segments = documentSnapshot.ref.path.split('/');
    return (
      segments.length === 4 &&
      segments[0] === 'communities' &&
      segments[2] === 'members' &&
      segments[3] === uid
    );
  }).length;
}

export const requestAccountDeletion = onCall<RequestAccountDeletionRequest>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    assertRecentAuthentication(
      request.auth?.token as Record<string, unknown> | undefined
    );

    const reason = normalizeOptionalReason(request.data?.reason);
    const now = Date.now();

    const schedule = await db.runTransaction(
      async (tx: FirebaseFirestore.Transaction): Promise<DeletionSchedule> => {
        const userRef = db.collection('users').doc(uid);
        const publicProfileRef = db.collection('public_profiles').doc(uid);
        const ownerSlotRef = db.collection('room_owner_slots').doc(uid);
        const ownedRoomsQuery = db
          .collection('rooms')
          .where('createdBy', '==', uid);
        const ownedCommunityMembershipsQuery = db
          .collectionGroup('members')
          .where('uid', '==', uid)
          .where('role', '==', 'owner')
          .limit(10);

        const [
          userSnap,
          ownerSlotSnapshot,
          ownedRoomsSnapshot,
          ownedCommunityMembershipsSnapshot,
        ] = await Promise.all([
          tx.get(userRef),
          tx.get(ownerSlotRef),
          tx.get(ownedRoomsQuery),
          tx.get(ownedCommunityMembershipsQuery),
        ]);

        if (!userSnap.exists) {
          throw new HttpsError('not-found', 'Usuário não encontrado.');
        }

        const user = (userSnap.data() ?? {}) as UserDoc;
        const currentStatus = String(user.accountStatus ?? 'active');

        if (currentStatus === 'deleted') {
          throw new HttpsError('failed-precondition', 'Conta já excluída.');
        }

        if (currentStatus === 'pending_deletion') {
          if (user.deletionRequestedBy !== 'self') {
            throw new HttpsError(
              'permission-denied',
              'A exclusão pendente foi aplicada por outro fluxo e não pode ser substituída.'
            );
          }

          const existingRequestedAt = Number(user.deletionRequestedAt ?? 0);
          const existingUndoUntil = Number(user.deletionUndoUntil ?? 0);
          const existingPurgeAfter = Number(user.purgeAfter ?? 0);
          const existingStatusUpdatedAt = Number(
            (user as UserDoc & { statusUpdatedAt?: number | null }).statusUpdatedAt ??
              existingRequestedAt
          );

          if (
            !existingRequestedAt ||
            !existingUndoUntil ||
            !existingPurgeAfter
          ) {
            throw new HttpsError(
              'data-loss',
              'O agendamento atual de exclusão está inconsistente.'
            );
          }

          return {
            deletionRequestedAt: existingRequestedAt,
            deletionUndoUntil: existingUndoUntil,
            purgeAfter: existingPurgeAfter,
            statusUpdatedAt: existingStatusUpdatedAt || existingRequestedAt,
          };
        }

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
          ownerSlot['active'] === true &&
          !!ownerSlotRoom &&
          !TERMINAL_ROOM_STATUSES.has(ownerSlotRoom.status);
        const ownedResourceDecision = evaluateAccountDeletionOwnedResources({
          ownedRoomStatuses: ownedRoomStatuses.map((room) => room.status),
          activeOwnerSlot,
          ownedCommunityCount: countOwnedCommunityMemberships(
            ownedCommunityMembershipsSnapshot,
            uid
          ),
        });

        if (!ownedResourceDecision.allowed) {
          throw new HttpsError(
            'failed-precondition',
            'Resolva os espaços sob sua responsabilidade antes de excluir a conta.',
            {
              reason: 'owned-resources-require-resolution',
              activeOwnedRoomCount:
                ownedResourceDecision.activeOwnedRoomCount,
              ownedCommunityCount:
                ownedResourceDecision.ownedCommunityCount,
              recommendedAction: 'resolve-owned-spaces',
            }
          );
        }

        const restoreStatus = normalizeRestorableStatus(currentStatus);
        const deletionUndoUntil = now + DEFAULT_UNDO_WINDOW_MS;
        const purgeAfter = deletionUndoUntil;
        const nicknameIndexDocId = getNicknameIndexDocId(user);

        tx.set(
          userRef,
          {
            accountStatus: 'pending_deletion',
            publicVisibility: 'hidden',
            interactionBlocked: true,
            loginAllowed: true,

            deletionRestoreStatus: restoreStatus,
            deletionRestoreSuspended:
              user.suspended === true || restoreStatus !== 'active',
            deletionRestoreSuspensionReason: user.suspensionReason ?? null,
            deletionRestoreSuspensionSource: user.suspensionSource ?? null,
            deletionRestoreSuspensionEndsAt: user.suspensionEndsAt ?? null,

            suspended: false,
            suspensionReason: null,
            suspensionSource: null,
            suspensionEndsAt: null,

            deletionRequestedAt: now,
            deletionRequestedBy: 'self',
            deletionUndoUntil,
            purgeAfter,

            statusUpdatedAt: now,
            statusUpdatedBy: 'self',
          },
          { merge: true }
        );

        tx.delete(publicProfileRef);

        if (nicknameIndexDocId) {
          tx.delete(db.collection('public_index').doc(nicknameIndexDocId));
        }

        createLifecycleAudit(tx, {
          uid,
          actorUid: uid,
          action: 'request_account_deletion',
          previousAccountStatus: restoreStatus,
          accountStatus: 'pending_deletion',
          source: 'self',
          moderationReason: reason,
          deletionRequestedAt: now,
          deletionUndoUntil,
          purgeAfter,
          createdAt: now,
          updatedAt: now,
        });

        return {
          deletionRequestedAt: now,
          deletionUndoUntil,
          purgeAfter,
          statusUpdatedAt: now,
        };
      }
    );

    return {
      ok: true,
      accountStatus: 'pending_deletion',
      publicVisibility: 'hidden',
      interactionBlocked: true,
      ...schedule,
      message:
        'Exclusão iniciada. Você pode cancelar dentro das próximas 24 horas.',
    };
  }
);
