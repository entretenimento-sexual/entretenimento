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
  isUserEligibleForPublicProjection,
  resolveNicknameNormalized,
} from './_shared';

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: 'active';
  publicVisibility: 'visible' | 'hidden';
  interactionBlocked: boolean;
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

    const restored = await db.runTransaction(
      async (tx: FirebaseFirestore.Transaction) => {
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
          return {
            publicVisibility:
              user.publicVisibility === 'visible' ? 'visible' : 'hidden',
            interactionBlocked: user.interactionBlocked === true,
          } as const;
        }

        if (currentStatus !== 'self_suspended') {
          throw new HttpsError(
            'permission-denied',
            'Somente uma autossuspensão pode ser reativada por este fluxo.'
          );
        }

        const canPublish = isUserEligibleForPublicProjection(user);
        const publicVisibility = canPublish ? 'visible' : 'hidden';
        const interactionBlocked = !canPublish;

        tx.set(
          userRef,
          {
            accountStatus: 'active',
            publicVisibility,
            interactionBlocked,
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

        const nicknameIndexDocId = getNicknameIndexDocId(user);

        if (canPublish) {
          tx.set(
            publicProfileRef,
            buildPublicProfileSeed(user, uid, now),
            { merge: true }
          );

          if (nicknameIndexDocId) {
            tx.set(
              db.collection('public_index').doc(nicknameIndexDocId),
              {
                type: 'nickname',
                value: resolveNicknameNormalized(user),
                uid,
                createdAt: now,
                lastChangedAt: now,
              },
              { merge: true }
            );
          }
        } else {
          tx.delete(publicProfileRef);
          if (nicknameIndexDocId) {
            tx.delete(db.collection('public_index').doc(nicknameIndexDocId));
          }
        }

        createLifecycleAudit(tx, {
          uid,
          actorUid: uid,
          action: 'reactivate_self_suspension',
          previousAccountStatus: 'self_suspended',
          accountStatus: 'active',
          publicProjectionRestored: canPublish,
          source: 'self',
          moderationReason: null,
          createdAt: now,
          updatedAt: now,
        });

        return { publicVisibility, interactionBlocked } as const;
      }
    );

    return {
      ok: true,
      accountStatus: 'active',
      ...restored,
      suspended: false,
      suspensionReason: null,
      suspensionSource: null,
      suspensionEndsAt: null,
      statusUpdatedAt: now,
      message:
        restored.publicVisibility === 'visible'
          ? 'Conta reativada com sucesso.'
          : 'Conta reativada. Conclua as verificações pendentes para voltar a aparecer e interagir.',
    };
  }
);
