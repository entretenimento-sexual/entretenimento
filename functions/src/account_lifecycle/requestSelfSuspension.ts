//functions\src\account_lifecycle\requestSelfSuspension.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';

interface RequestSelfSuspensionRequest {
  reason?: string | null;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus?: string | null;
  message?: string | null;
}

type AccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

type UserDoc = {
  uid?: string;
  nickname?: string | null;
  nicknameNormalized?: string | null;
  photoURL?: string | null;
  municipio?: string | null;
  estado?: string | null;
  gender?: string | null;
  orientation?: string | null;
  role?: string | null;
  accountStatus?: AccountStatus;
  deletionRequestedBy?: 'self' | 'moderator' | null;
};

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

export const requestSelfSuspension = onCall<RequestSelfSuspensionRequest>(
  async (request): Promise<AccountLifecycleCommandResult> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const reason = normalizeOptionalReason(request.data?.reason);
    const now = Date.now();

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const userRef = db.collection('users').doc(uid);
      const publicProfileRef = db.collection('public_profiles').doc(uid);

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new HttpsError('not-found', 'Usuário não encontrado.');
      }

      const user = (userSnap.data() ?? {}) as UserDoc;
      const currentStatus = user.accountStatus ?? 'active';

      if (currentStatus === 'deleted') {
        throw new HttpsError(
          'failed-precondition',
          'Conta já excluída.'
        );
      }

      if (currentStatus === 'pending_deletion') {
        throw new HttpsError(
          'failed-precondition',
          'Conta em exclusão pendente não pode ser auto suspensa.'
        );
      }

      const nicknameIndexDocId = getNicknameIndexDocId(user);

      tx.set(
        userRef,
        {
          accountStatus: 'self_suspended',
          publicVisibility: 'hidden',
          interactionBlocked: true,
          loginAllowed: true,

          suspended: true,
          suspensionReason: reason,
          suspensionSource: 'self',
          suspensionEndsAt: null,

          suspendedAtMs: now,
          suspendedBy: 'self',

          deletionRequestedAt: null,
          deletionRequestedBy: null,
          deletionUndoUntil: null,
          purgeAfter: null,

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
        action: 'request_self_suspension',
        accountStatus: 'self_suspended',
        source: 'self',
        moderationReason: reason,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      accountStatus: 'self_suspended',
      message: 'Conta suspensa com sucesso.',
    };
  }
);