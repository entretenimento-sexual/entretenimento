// functions/src/account_lifecycle/moderateUnsuspendAccount.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  UserDoc,
  assertRecentAuthentication,
  assertStaffAuthorization,
  buildPublicProfileSeed,
  createLifecycleAudit,
  getNicknameIndexDocId,
  isUserEligibleForPublicProjection,
  resolveNicknameNormalized,
} from './_shared';

interface ModerateUnsuspendAccountRequest {
  targetUid: string;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: 'active';
  publicVisibility: 'visible' | 'hidden';
  interactionBlocked: boolean;
  message: string;
}

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

export const moderateUnsuspendAccount = onCall<ModerateUnsuspendAccountRequest>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const actorUid = request.auth?.uid ?? null;
    const authToken = (request.auth?.token ?? {}) as Record<string, unknown>;

    assertRecentAuthentication(authToken);
    await assertStaffAuthorization({
      actorUid,
      authToken,
      requiredPermission: 'users:suspend',
    });

    const targetUid = normalizeUid(request.data?.targetUid);
    const now = Date.now();

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'UID alvo inválido.');
    }

    const restored = await db.runTransaction(
      async (tx: FirebaseFirestore.Transaction) => {
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
          throw new HttpsError(
            'failed-precondition',
            'A conta não possui uma suspensão da moderação para remover.'
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
            unsuspendedBy: actorUid,
            statusUpdatedAt: now,
            statusUpdatedBy: actorUid,
          },
          { merge: true }
        );

        const nicknameIndexDocId = getNicknameIndexDocId(user);

        if (canPublish) {
          tx.set(
            publicProfileRef,
            buildPublicProfileSeed(user, targetUid, now),
            { merge: true }
          );

          if (nicknameIndexDocId) {
            tx.set(
              db.collection('public_index').doc(nicknameIndexDocId),
              {
                type: 'nickname',
                value: resolveNicknameNormalized(user),
                uid: targetUid,
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
          uid: targetUid,
          actorUid,
          action: 'moderate_unsuspend_account',
          previousAccountStatus: 'moderation_suspended',
          accountStatus: 'active',
          publicProjectionRestored: canPublish,
          source: 'moderator',
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
      message:
        restored.publicVisibility === 'visible'
          ? 'Conta reativada pela moderação.'
          : 'Conta reativada, mas permanece privada até concluir as verificações pendentes.',
    };
  }
);
