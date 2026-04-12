//functions\src\account_lifecycle\moderateUnsuspendAccount.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  UserDoc,
  assertStaffAuthorization,
  buildPublicProfileSeed,
  createLifecycleAudit,
  getNicknameIndexDocId,
  normalizeNicknameForIndex,
} from './_shared';

interface ModerateUnsuspendAccountRequest {
  targetUid: string;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus?: string | null;
  message?: string | null;
}

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

export const moderateUnsuspendAccount = onCall<ModerateUnsuspendAccountRequest>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const actorUid = request.auth?.uid ?? null;
    await assertStaffAuthorization({
      actorUid,
      authToken: (request.auth?.token ?? {}) as Record<string, unknown>,
      requiredPermission: 'users:suspend',
    });

    const targetUid = normalizeUid(request.data?.targetUid);
    const now = Date.now();

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'UID alvo inválido.');
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

      if (currentStatus !== 'moderation_suspended') {
        return;
      }

      tx.set(
        userRef,
        {
          accountStatus: 'active',
          publicVisibility: 'visible',
          interactionBlocked: false,
          loginAllowed: true,

          suspended: false,
          suspensionReason: null,
          suspensionSource: null,
          suspensionEndsAt: null,

          unsuspendedAtMs: now,
          unsuspendedBy: actorUid,

          statusUpdatedAt: now,
          statusUpdatedBy: actorUid,
        },
        { merge: true }
      );

      tx.set(publicProfileRef, buildPublicProfileSeed(user, targetUid, now), {
        merge: true,
      });

      const nicknameIndexDocId = getNicknameIndexDocId(user);
      if (nicknameIndexDocId) {
        const nicknameIndexRef = db.collection('public_index').doc(nicknameIndexDocId);
        tx.set(
          nicknameIndexRef,
          {
            type: 'nickname',
            value:
              String(user.nicknameNormalized ?? '').trim() ||
              normalizeNicknameForIndex(user.nickname),
            uid: targetUid,
            createdAt: now,
            lastChangedAt: now,
          },
          { merge: true }
        );
      }

      createLifecycleAudit(tx, {
        uid: targetUid,
        actorUid,
        action: 'moderate_unsuspend_account',
        accountStatus: 'active',
        source: 'moderator',
        moderationReason: null,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      accountStatus: 'active',
      message: 'Conta reativada pela moderação.',
    };
  }
);