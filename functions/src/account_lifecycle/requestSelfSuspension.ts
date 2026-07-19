// functions/src/account_lifecycle/requestSelfSuspension.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  UserDoc,
  assertRecentAuthentication,
  createLifecycleAudit,
  getNicknameIndexDocId,
  normalizeOptionalReason,
} from './_shared';

interface RequestSelfSuspensionRequest {
  reason?: string | null;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: 'self_suspended';
  publicVisibility: 'hidden';
  interactionBlocked: true;
  statusUpdatedAt: number;
  message: string;
}

export const requestSelfSuspension = onCall<RequestSelfSuspensionRequest>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    assertRecentAuthentication(
      request.auth?.token as Record<string, unknown> | undefined
    );

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
      const currentStatus = String(user.accountStatus ?? 'active');

      if (currentStatus === 'deleted') {
        throw new HttpsError('failed-precondition', 'Conta já excluída.');
      }

      if (currentStatus === 'pending_deletion') {
        throw new HttpsError(
          'failed-precondition',
          'Conta em exclusão pendente não pode ser suspensa por este fluxo.'
        );
      }

      /**
       * Uma suspensão aplicada pela moderação jamais pode ser substituída por uma
       * autossuspensão. Caso contrário, o usuário conseguiria reativar a própria
       * conta e contornar a decisão administrativa.
       */
      if (currentStatus === 'moderation_suspended') {
        throw new HttpsError(
          'permission-denied',
          'A suspensão aplicada pela moderação não pode ser alterada por este fluxo.',
          { reason: 'moderation-suspension-active' }
        );
      }

      if (currentStatus === 'self_suspended') {
        return;
      }

      if (currentStatus !== 'active') {
        throw new HttpsError(
          'failed-precondition',
          'A conta não pode ser suspensa no estado atual.'
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
        tx.delete(db.collection('public_index').doc(nicknameIndexDocId));
      }

      createLifecycleAudit(tx, {
        uid,
        actorUid: uid,
        action: 'request_self_suspension',
        previousAccountStatus: currentStatus,
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
      publicVisibility: 'hidden',
      interactionBlocked: true,
      statusUpdatedAt: now,
      message: 'Conta suspensa com sucesso.',
    };
  }
);
