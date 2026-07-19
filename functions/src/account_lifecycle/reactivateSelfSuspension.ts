// functions/src/account_lifecycle/reactivateSelfSuspension.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  UserDoc,
  assertRecentAuthentication,
  buildPublicProfileSeed,
  createLifecycleAudit,
  getNicknameIndexDocId,
  normalizeNicknameForIndex,
} from './_shared';

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: 'active';
  publicVisibility: 'visible';
  interactionBlocked: false;
  suspended: false;
  suspensionReason: null;
  suspensionSource: null;
  suspensionEndsAt: null;
  statusUpdatedAt: number;
  message: string;
}

export const reactivateSelfSuspension = onCall<Record<string, never>>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    assertRecentAuthentication(
      request.auth?.token as Record<string, unknown> | undefined
    );

    const now = Date.now();

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

      if (currentStatus === 'active') {
        return;
      }

      if (currentStatus !== 'self_suspended') {
        throw new HttpsError(
          'permission-denied',
          'Somente uma autossuspensão pode ser reativada por este fluxo.'
        );
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
          unsuspendedBy: 'self',

          statusUpdatedAt: now,
          statusUpdatedBy: 'self',
        },
        { merge: true }
      );

      tx.set(
        publicProfileRef,
        buildPublicProfileSeed(user, uid, now),
        { merge: true }
      );

      const nicknameIndexDocId = getNicknameIndexDocId(user);
      if (nicknameIndexDocId) {
        tx.set(
          db.collection('public_index').doc(nicknameIndexDocId),
          {
            type: 'nickname',
            value:
              String(user.nicknameNormalized ?? '').trim() ||
              normalizeNicknameForIndex(user.nickname),
            uid,
            createdAt: now,
            lastChangedAt: now,
          },
          { merge: true }
        );
      }

      createLifecycleAudit(tx, {
        uid,
        actorUid: uid,
        action: 'reactivate_self_suspension',
        previousAccountStatus: 'self_suspended',
        accountStatus: 'active',
        source: 'self',
        moderationReason: null,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      accountStatus: 'active',
      publicVisibility: 'visible',
      interactionBlocked: false,
      suspended: false,
      suspensionReason: null,
      suspensionSource: null,
      suspensionEndsAt: null,
      statusUpdatedAt: now,
      message: 'Conta reativada com sucesso.',
    };
  }
);
