// functions/src/account_lifecycle/reactivateSelfSuspension.ts
import {
  deleteOwnedNicknameIndex, readNicknameIndex, writeNicknameIndex,
} from '../public_index/nickname-index.service';
import { resolveNicknameNormalized } from '../public_index/nickname-key.policy';
import { canPublishNicknameIndex } from '../registration/registration-nickname-availability.policy';
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
  buildPublicProfileSeed,
  createLifecycleAudit,
  canRestorePublicProfileProjection,
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
  subscriptionRenewalStatus: 'active' | 'canceled' | 'pending' | 'none';
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

    await assertAccountLifecycleMutationSecurity({
      action: 'self_reactivate',
      subjectUid: uid,
      appContext: request.app,
    });

    const now = Date.now();

    const { publicationDeferred, ...restored } = await db.runTransaction(
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
            publicationDeferred: false,
          } as const;
        }

        if (currentStatus !== 'self_suspended') {
          throw new HttpsError(
            'permission-denied',
            'Somente uma autossuspensão pode ser reativada por este fluxo.'
          );
        }

        const nicknameIndex = await readNicknameIndex(db, tx, resolveNicknameNormalized(user));
        const hasPublicationEligibility = canRestorePublicProfileProjection(user);
        const canPublish = hasPublicationEligibility &&
          await canPublishNicknameIndex(db, tx, nicknameIndex, uid, user);
        const publicationDeferred = hasPublicationEligibility && !canPublish;
        const publicVisibility = canPublish ? 'visible' : 'hidden';
        const interactionBlocked = !canPublish;

        tx.set(
          userRef,
          {
            accountStatus: 'active',
            publicVisibility,
            interactionBlocked,
            loginAllowed: user.loginAllowed !== false,
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

        if (canPublish) {
          tx.set(
            publicProfileRef,
            buildPublicProfileSeed(user, uid, now),
            { merge: true }
          );

          if (nicknameIndex) writeNicknameIndex(tx, nicknameIndex, uid);
        } else {
          tx.delete(publicProfileRef);
          deleteOwnedNicknameIndex(tx, nicknameIndex, uid);
        }

        createLifecycleAudit(tx, {
          uid,
          actorUid: uid,
          action: 'reactivate_self_suspension',
          previousAccountStatus: 'self_suspended',
          accountStatus: 'active',
          publicProjectionRestored: canPublish,
          nicknamePublicationDeferred: publicationDeferred,
          source: 'self',
          moderationReason: null,
          createdAt: now,
          updatedAt: now,
        });

        return { publicVisibility, interactionBlocked, publicationDeferred } as const;
      }
    );

    const subscriptionRenewalStatus =
      await getAccountLifecycleSubscriptionRenewalStatus(uid);
    const accountMessage = publicationDeferred
      ? 'Conta reativada. Não foi possível confirmar seu apelido. ' +
        'Seu perfil continua oculto. Se isso persistir, fale com o suporte.'
      : restored.publicVisibility === 'visible'
        ? 'Conta reativada com sucesso.'
        : 'Conta reativada. Conclua as verificações pendentes para voltar a aparecer e interagir.';
    const subscriptionMessage = subscriptionRenewalStatus === 'pending'
      ? 'A interrupção da renovação automática ainda está sendo processada.'
      : subscriptionRenewalStatus === 'canceled'
        ? 'A renovação automática permanece cancelada. Revise sua assinatura se quiser voltar a renovar.'
        : '';

    return {
      ok: true,
      accountStatus: 'active',
      ...restored,
      suspended: false,
      suspensionReason: null,
      suspensionSource: null,
      suspensionEndsAt: null,
      statusUpdatedAt: now,
      subscriptionRenewalStatus,
      message: [accountMessage, subscriptionMessage].filter(Boolean).join(' '),
    };
  }
);
