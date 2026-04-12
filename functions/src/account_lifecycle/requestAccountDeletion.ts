//functions\src\account_lifecycle\requestAccountDeletion.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';

interface RequestAccountDeletionRequest {
  reason?: string | null;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus?: string | null;
  message?: string | null;
}

type UserDoc = {
  uid?: string;
  nickname?: string | null;
  nicknameNormalized?: string | null;
  accountStatus?: string | null;
};

const DEFAULT_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeOptionalReason(reason?: string | null): string | null {
  const safe = String(reason ?? '').trim();
  return safe || null;
}

function normalizeNicknameForIndex(raw?: string | null): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function getNicknameIndexDocId(user: UserDoc): string | null {
  const normalized =
    String(user.nicknameNormalized ?? '').trim() ||
    normalizeNicknameForIndex(user.nickname);

  return normalized ? `nickname:${normalized}` : null;
}

export const requestAccountDeletion = onCall<RequestAccountDeletionRequest>(
  async (request): Promise<AccountLifecycleCommandResult> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const reason = normalizeOptionalReason(request.data?.reason);
    const now = Date.now();
    const deletionUndoUntil = now + DEFAULT_UNDO_WINDOW_MS;

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const userRef = db.collection('users').doc(uid);
      const publicProfileRef = db.collection('public_profiles').doc(uid);

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new HttpsError('not-found', 'Usuário não encontrado.');
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
          loginAllowed: true,

          suspended: false,
          suspensionReason: null,
          suspensionSource: null,
          suspensionEndsAt: null,

          deletionRequestedAt: now,
          deletionRequestedBy: 'self',
          deletionUndoUntil,
          purgeAfter: deletionUndoUntil,

          statusUpdatedAt: now,
          statusUpdatedBy: 'self',
        },
        { merge: true }
      );

      tx.delete(publicProfileRef);

      if (nicknameIndexDocId) {
        const nicknameIndexRef = db.collection('public_index').doc(nicknameIndexDocId);
        tx.delete(nicknameIndexRef);
      }

      const auditRef = db.collection('account_lifecycle_audit').doc();
      tx.set(auditRef, {
        uid,
        action: 'request_account_deletion',
        accountStatus: 'pending_deletion',
        source: 'self',
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
      message: 'Exclusão iniciada com janela de arrependimento.',
    };
  }
);