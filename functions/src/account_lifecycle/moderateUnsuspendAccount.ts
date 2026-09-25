// functions/src/account_lifecycle/moderateUnsuspendAccount.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  assertAccountLifecycleMutationSecurity,
} from './account-lifecycle-mutation-security';
import { db } from '../firebaseApp';
import {
  getAccountLifecycleSubscriptionRenewalStatus,
} from './account-lifecycle-billing.service';
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
  subscriptionRenewalStatus: 'active' | 'canceled' | 'pending' | 'none';
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

    await assertAccountLifecycleMutationSecurity({
      action: 'moderation_unsuspend',
      subjectUid: actorUid,
      appContext: request.app,
    });

    const targetUid = normalizeUid(request.data?.targetUid);
    const now = Date.now();

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'UID alvo inválido.');
    }

    if (targetUid === actorUid) {
      throw new HttpsError(
        'failed-precondition',
        'A moderação não pode alterar o próprio lifecycle por este fluxo.'
      );
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

    const subscriptionRenewalStatus =
      await getAccountLifecycleSubscriptionRenewalStatus(targetUid);

    return {
      ok: true,
      accountStatus: 'active',
      ...restored,
      subscriptionRenewalStatus,
      message:
        subscriptionRenewalStatus === 'pending'
          ? 'Conta reativada pela moderação. A interrupção da renovação ainda está sendo processada.'
          : subscriptionRenewalStatus === 'canceled'
            ? 'Conta reativada pela moderação. A renovação automática permanece cancelada.'
            : restored.publicVisibility === 'visible'
              ? 'Conta reativada pela moderação.'
              : 'Conta reativada, mas permanece privada até concluir as verificações pendentes.',
    };
  }
);
