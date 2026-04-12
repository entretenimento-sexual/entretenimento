//functions\src\account_lifecycle\moderateSuspendAccount.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  UserDoc,
  assertStaffAuthorization,
  createLifecycleAudit,
  getNicknameIndexDocId,
  normalizeOptionalReason,
  normalizeRequiredReason,
} from './_shared';

interface ModerateSuspendAccountRequest {
  targetUid: string;
  reason: string;
  endsAt?: number | null;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus?: string | null;
  message?: string | null;
}

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

function normalizeOptionalEpoch(value?: number | null): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value > 0 ? value : null;
}

export const moderateSuspendAccount = onCall<ModerateSuspendAccountRequest>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const actorUid = request.auth?.uid ?? null;
    await assertStaffAuthorization({
      actorUid,
      authToken: (request.auth?.token ?? {}) as Record<string, unknown>,
      requiredPermission: 'users:suspend',
    });

    const targetUid = normalizeUid(request.data?.targetUid);
    const reason = normalizeRequiredReason(request.data?.reason);
    const endsAt = normalizeOptionalEpoch(request.data?.endsAt);
    const now = Date.now();

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'UID alvo inválido.');
    }

    if (!reason) {
      throw new HttpsError('invalid-argument', 'Motivo da suspensão é obrigatório.');
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
        throw new HttpsError(
          'failed-precondition',
          'Conta em exclusão pendente não pode ser suspensa.'
        );
      }

      const nicknameIndexDocId = getNicknameIndexDocId(user);

      tx.set(
        userRef,
        {
          accountStatus: 'moderation_suspended',
          publicVisibility: 'hidden',
          interactionBlocked: true,
          loginAllowed: true,

          suspended: true,
          suspensionReason: reason,
          suspensionSource: 'moderator',
          suspensionEndsAt: endsAt,

          suspendedAtMs: now,
          suspendedBy: actorUid,

          deletionRequestedAt: null,
          deletionRequestedBy: null,
          deletionUndoUntil: null,
          purgeAfter: null,

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
        action: 'moderate_suspend_account',
        accountStatus: 'moderation_suspended',
        source: 'moderator',
        moderationReason: reason,
        suspensionEndsAt: endsAt,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      accountStatus: 'moderation_suspended',
      message: 'Conta suspensa pela moderação.',
    };
  }
);