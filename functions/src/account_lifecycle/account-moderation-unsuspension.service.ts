// functions/src/account_lifecycle/account-moderation-unsuspension.service.ts
// -----------------------------------------------------------------------------
// ACCOUNT MODERATION UNSUSPENSION SERVICE
// -----------------------------------------------------------------------------
// Fonte canônica para restaurar uma conta suspensa pela moderação, seja por
// ação manual autorizada ou por expiração automática do prazo.
// -----------------------------------------------------------------------------

import {
  deleteOwnedNicknameIndex, readNicknameIndex, writeNicknameIndex,
} from '../public_index/nickname-index.service';
import { resolveNicknameNormalized } from '../public_index/nickname-key.policy';
import { canPublishNicknameIndex } from '../registration/registration-nickname-availability.policy';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
import {
  UserDoc,
  assertStaffAuthorization,
  buildPublicProfileSeed,
  createLifecycleAudit,
  canRestorePublicProfileProjection,
} from './_shared';
import {
  evaluateModerationSuspensionExpiry,
} from './account-suspension-expiry.policy';

export interface ModerationUnsuspensionResult {
  changed: boolean;
  publicVisibility: 'visible' | 'hidden';
  interactionBlocked: boolean;
  previousSuspensionEndsAt: number | null;
}

export async function restoreModerationSuspension(input: {
  targetUid: string;
  actorUid: string;
  source: 'moderator' | 'system';
  requireExpired?: boolean;
  now?: number;
}): Promise<ModerationUnsuspensionResult> {
  const now = Number.isFinite(input.now)
    ? Math.trunc(input.now as number)
    : Date.now();

  return db.runTransaction(
    async (tx: FirebaseFirestore.Transaction): Promise<ModerationUnsuspensionResult> => {
      if (input.source === 'moderator') {
        await assertStaffAuthorization({
          actorUid: input.actorUid,
          requiredPermission: 'users:suspend',
        }, tx);
      }
      const userRef = db.collection('users').doc(input.targetUid);
      const publicProfileRef = db
        .collection('public_profiles')
        .doc(input.targetUid);
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        if (input.source === 'system') {
          return {
            changed: false,
            publicVisibility: 'hidden',
            interactionBlocked: true,
            previousSuspensionEndsAt: null,
          };
        }

        throw new HttpsError('not-found', 'Usuário alvo não encontrado.');
      }

      const user = (userSnap.data() ?? {}) as UserDoc;
      const currentStatus = String(user.accountStatus ?? 'active');

      if (currentStatus === 'deleted') {
        if (input.source === 'system') {
          return {
            changed: false,
            publicVisibility: 'hidden',
            interactionBlocked: true,
            previousSuspensionEndsAt: null,
          };
        }

        throw new HttpsError('failed-precondition', 'Conta já excluída.');
      }

      const expiry = evaluateModerationSuspensionExpiry({
        accountStatus: currentStatus,
        suspensionEndsAt: user.suspensionEndsAt,
        now,
      });

      if (currentStatus !== 'moderation_suspended') {
        if (input.source === 'system') {
          return {
            changed: false,
            publicVisibility:
              user.publicVisibility === 'visible' ? 'visible' : 'hidden',
            interactionBlocked: user.interactionBlocked === true,
            previousSuspensionEndsAt: expiry.suspensionEndsAt,
          };
        }

        throw new HttpsError(
          'failed-precondition',
          'A conta não possui uma suspensão da moderação para remover.'
        );
      }

      if (input.requireExpired === true && !expiry.due) {
        return {
          changed: false,
          publicVisibility: 'hidden',
          interactionBlocked: true,
          previousSuspensionEndsAt: expiry.suspensionEndsAt,
        };
      }

      const nicknameIndex = await readNicknameIndex(db, tx, resolveNicknameNormalized(user));
      const hasPublicationEligibility = canRestorePublicProfileProjection(user);
      const canPublish = hasPublicationEligibility &&
        await canPublishNicknameIndex(db, tx, nicknameIndex, input.targetUid, user);
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
          unsuspendedBy: input.actorUid,
          statusUpdatedAt: now,
          statusUpdatedBy: input.actorUid,
        },
        { merge: true }
      );

      if (canPublish) {
        tx.set(
          publicProfileRef,
          buildPublicProfileSeed(user, input.targetUid, now),
          { merge: true }
        );

        if (nicknameIndex) writeNicknameIndex(tx, nicknameIndex, input.targetUid);
      } else {
        tx.delete(publicProfileRef);

        deleteOwnedNicknameIndex(tx, nicknameIndex, input.targetUid);
      }

      if (input.source === 'system') {
        const notificationId =
          `moderation_suspension_expired_${input.targetUid}_${expiry.suspensionEndsAt ?? now}`;

        tx.set(
          db.collection('notifications').doc(notificationId),
          {
            userId: input.targetUid,
            type: 'compliance.action.taken',
            title: 'Suspensão encerrada',
            body: canPublish
              ? 'O período de suspensão terminou e sua conta voltou ao estado ativo.'
              : publicationDeferred
                ? 'Sua conta foi reativada. Não foi possível confirmar seu apelido. ' +
                  'Seu perfil continua oculto. Se isso persistir, fale com o suporte.'
                : [
                  'O período de suspensão terminou. A conta foi reativada,',
                  'mas algumas verificações ainda limitam visibilidade e interação.',
                ].join(' '),
            route: '/conta/status',
            actionRequired: !canPublish,
            readAt: null,
            createdAt: now,
            updatedAt: now,
          },
          { merge: false }
        );
      }

      createLifecycleAudit(tx, {
        uid: input.targetUid,
        actorUid: input.actorUid,
        action:
          input.source === 'system'
            ? 'expire_moderation_suspension'
            : 'moderate_unsuspend_account',
        previousAccountStatus: 'moderation_suspended',
        nicknamePublicationDeferred: publicationDeferred,
        accountStatus: 'active',
        publicProjectionRestored: canPublish,
        source: input.source,
        moderationReason: null,
        suspensionEndsAt: expiry.suspensionEndsAt,
        createdAt: now,
        updatedAt: now,
      });

      return {
        changed: true,
        publicVisibility,
        interactionBlocked,
        previousSuspensionEndsAt: expiry.suspensionEndsAt,
      };
    }
  );
}
