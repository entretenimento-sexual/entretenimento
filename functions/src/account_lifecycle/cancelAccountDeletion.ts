// functions/src/account_lifecycle/cancelAccountDeletion.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  RestorableAccountStatus,
  UserDoc,
  assertRecentAuthentication,
  buildPublicProfileSeed,
  createLifecycleAudit,
  getNicknameIndexDocId,
  normalizeNicknameForIndex,
} from './_shared';

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: RestorableAccountStatus;
  publicVisibility: 'visible' | 'hidden';
  interactionBlocked: boolean;
  suspended: boolean;
  suspensionReason: string | null;
  suspensionSource: 'self' | 'moderator' | null;
  suspensionEndsAt: number | null;
  statusUpdatedAt: number;
  message: string;
}

function normalizeRestoreStatus(value: unknown): RestorableAccountStatus {
  return value === 'self_suspended' || value === 'moderation_suspended'
    ? value
    : 'active';
}

export const cancelAccountDeletion = onCall<Record<string, never>>(
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
      async (
        tx: FirebaseFirestore.Transaction
      ): Promise<Omit<AccountLifecycleCommandResult, 'ok' | 'message'>> => {
        const userRef = db.collection('users').doc(uid);
        const publicProfileRef = db.collection('public_profiles').doc(uid);

        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) {
          throw new HttpsError('not-found', 'Usuário não encontrado.');
        }

        const user = (userSnap.data() ?? {}) as UserDoc;
        const currentStatus = String(user.accountStatus ?? 'active');

        if (currentStatus !== 'pending_deletion') {
          throw new HttpsError(
            'failed-precondition',
            'A conta não possui exclusão pendente para cancelar.'
          );
        }

        if (user.deletionRequestedBy !== 'self') {
          throw new HttpsError(
            'permission-denied',
            'A exclusão pendente não pode ser cancelada por este fluxo.'
          );
        }

        const undoUntil = Number(user.deletionUndoUntil ?? 0);
        if (!undoUntil || now > undoUntil) {
          throw new HttpsError(
            'failed-precondition',
            'A janela de arrependimento já expirou.',
            { reason: 'deletion-undo-window-expired' }
          );
        }

        const accountStatus = normalizeRestoreStatus(
          user.deletionRestoreStatus
        );
        const restricted = accountStatus !== 'active';
        const publicVisibility = restricted ? 'hidden' : 'visible';
        const interactionBlocked = restricted;
        const suspended = restricted;
        const suspensionReason = restricted
          ? user.deletionRestoreSuspensionReason ?? null
          : null;
        const suspensionSource = restricted
          ? user.deletionRestoreSuspensionSource ??
            (accountStatus === 'self_suspended' ? 'self' : 'moderator')
          : null;
        const suspensionEndsAt = restricted
          ? user.deletionRestoreSuspensionEndsAt ?? null
          : null;

        tx.set(
          userRef,
          {
            accountStatus,
            publicVisibility,
            interactionBlocked,
            loginAllowed: true,
            suspended,
            suspensionReason,
            suspensionSource,
            suspensionEndsAt,

            deletionRequestedAt: null,
            deletionRequestedBy: null,
            deletionUndoUntil: null,
            purgeAfter: null,
            deletionRestoreStatus: FieldValue.delete(),
            deletionRestoreSuspended: FieldValue.delete(),
            deletionRestoreSuspensionReason: FieldValue.delete(),
            deletionRestoreSuspensionSource: FieldValue.delete(),
            deletionRestoreSuspensionEndsAt: FieldValue.delete(),

            statusUpdatedAt: now,
            statusUpdatedBy: 'self',
          },
          { merge: true }
        );

        const nicknameIndexDocId = getNicknameIndexDocId(user);

        if (accountStatus === 'active') {
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
        } else {
          tx.delete(publicProfileRef);
          if (nicknameIndexDocId) {
            tx.delete(db.collection('public_index').doc(nicknameIndexDocId));
          }
        }

        createLifecycleAudit(tx, {
          uid,
          actorUid: uid,
          action: 'cancel_account_deletion',
          previousAccountStatus: 'pending_deletion',
          accountStatus,
          source: 'self',
          moderationReason: null,
          createdAt: now,
          updatedAt: now,
        });

        return {
          accountStatus,
          publicVisibility,
          interactionBlocked,
          suspended,
          suspensionReason,
          suspensionSource,
          suspensionEndsAt,
          statusUpdatedAt: now,
        };
      }
    );

    return {
      ok: true,
      ...restored,
      message:
        restored.accountStatus === 'active'
          ? 'Exclusão cancelada. Sua conta voltou ao estado ativo.'
          : 'Exclusão cancelada. O estado anterior da conta foi restaurado.',
    };
  }
);
