//functions\src\account_lifecycle\moderateScheduleDeletion.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  UserDoc,
  assertStaffAuthorization,
  createLifecycleAudit,
  getNicknameIndexDocId,
  normalizeRequiredReason,
} from './_shared';

interface ModerateScheduleDeletionRequest {
  targetUid: string;
  reason: string;
  undoWindowMs?: number | null;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus?: string | null;
  message?: string | null;
}

const DEFAULT_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

function normalizeOptionalWindow(value?: number | null): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value > 0 ? value : null;
}

export const moderateScheduleDeletion = onCall<ModerateScheduleDeletionRequest>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const actorUid = request.auth?.uid ?? null;
    await assertStaffAuthorization({
      actorUid,
      authToken: (request.auth?.token ?? {}) as Record<string, unknown>,
      requiredPermission: 'users:delete',
    });

    const targetUid = normalizeUid(request.data?.targetUid);
    const reason = normalizeRequiredReason(request.data?.reason);
    const undoWindowMs =
      normalizeOptionalWindow(request.data?.undoWindowMs) ?? DEFAULT_UNDO_WINDOW_MS;

    const now = Date.now();
    const deletionUndoUntil = now + undoWindowMs;

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'UID alvo inválido.');
    }

    if (!reason) {
      throw new HttpsError('invalid-argument', 'Motivo da exclusão é obrigatório.');
    }

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const userRef = db.collection('users').doc(targetUid);
      const publicProfileRef = db.collection('public_profiles').doc(targetUid);

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new HttpsError('not-found', 'Usuário alvo não encontrado.');
      }

      const user = (userSnap.data() ?? {}) as UserDoc;
      const currentStatus = String(user.accountStatus ?? 'active');

      if (currentStatus === 'deleted') {
        throw new HttpsError('failed-precondition', 'Conta já excluída.');
      }

      if (currentStatus === 'pending_deletion') {
        return;
      }

      const nicknameIndexDocId = getNicknameIndexDocId(user);

      tx.set(
        userRef,
        {
          accountStatus: 'pending_deletion',
          publicVisibility: 'hidden',
          interactionBlocked: true,

          /**
           * Mantemos loginAllowed = true para que o usuário ainda possa
           * visualizar o estado da conta. O cancelamento, no entanto,
           * continua restrito ao fluxo próprio do backend.
           */
          loginAllowed: true,

          suspended: false,
          suspensionReason: null,
          suspensionSource: null,
          suspensionEndsAt: null,

          deletionRequestedAt: now,
          deletionRequestedBy: 'moderator',
          deletionUndoUntil,
          purgeAfter: deletionUndoUntil,

          statusUpdatedAt: now,
          statusUpdatedBy: actorUid,
        },
        { merge: true }
      );

      tx.delete(publicProfileRef);

      if (nicknameIndexDocId) {
        const nicknameIndexRef = db.collection('public_index').doc(nicknameIndexDocId);
        tx.delete(nicknameIndexRef);
      }

      createLifecycleAudit(tx, {
        uid: targetUid,
        actorUid,
        action: 'moderate_schedule_deletion',
        accountStatus: 'pending_deletion',
        source: 'moderator',
        moderationReason: reason,
        deletionRequestedAt: now,
        deletionUndoUntil,
        purgeAfter: deletionUndoUntil,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      accountStatus: 'pending_deletion',
      message: 'Exclusão da conta agendada pela moderação.',
    };
  }
);