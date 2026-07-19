// functions/src/account_lifecycle/moderateSuspendAccount.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  UserDoc,
  assertRecentAuthentication,
  assertStaffAuthorization,
  createLifecycleAudit,
  getNicknameIndexDocId,
  normalizeRequiredReason,
} from './_shared';

interface ModerateSuspendAccountRequest {
  targetUid: string;
  reason: string;
  endsAt?: number | null;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: 'moderation_suspended';
  message: string;
}

const MAX_SUSPENSION_WINDOW_MS = 365 * 24 * 60 * 60 * 1_000;

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

function normalizeOptionalEpoch(
  value: number | null | undefined,
  now: number
): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpsError(
      'invalid-argument',
      'Data final da suspensão inválida.'
    );
  }

  const normalized = Math.trunc(value);
  if (
    normalized <= now ||
    normalized > now + MAX_SUSPENSION_WINDOW_MS
  ) {
    throw new HttpsError(
      'invalid-argument',
      'A data final deve estar no futuro e dentro de um ano.'
    );
  }

  return normalized;
}

export const moderateSuspendAccount = onCall<ModerateSuspendAccountRequest>(
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
    const reason = normalizeRequiredReason(request.data?.reason);
    const now = Date.now();
    const endsAt = normalizeOptionalEpoch(request.data?.endsAt, now);

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'UID alvo inválido.');
    }

    if (targetUid === actorUid) {
      throw new HttpsError(
        'failed-precondition',
        'A moderação não pode alterar o próprio lifecycle por este fluxo.'
      );
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

      if (currentStatus === 'pending_deletion') {
        throw new HttpsError(
          'failed-precondition',
          'Conta em exclusão pendente não pode ser suspensa.'
        );
      }

      const nicknameIndexDocId = getNicknameIndexDocId(user);

      tx.set(
        userRef,
        {
          accountStatus: 'moderation_suspended',
          publicVisibility: 'hidden',
          interactionBlocked: true,
          loginAllowed: true,
          suspended: true,
          suspensionReason: reason,
          suspensionSource: 'moderator',
          suspensionEndsAt: endsAt,
          suspendedAtMs: now,
          suspendedBy: actorUid,
          deletionRequestedAt: null,
          deletionRequestedBy: null,
          deletionUndoUntil: null,
          purgeAfter: null,
          statusUpdatedAt: now,
          statusUpdatedBy: actorUid,
        },
        { merge: true }
      );

      tx.delete(publicProfileRef);

      if (nicknameIndexDocId) {
        tx.delete(db.collection('public_index').doc(nicknameIndexDocId));
      }

      createLifecycleAudit(tx, {
        uid: targetUid,
        actorUid,
        action: 'moderate_suspend_account',
        previousAccountStatus: currentStatus,
        accountStatus: 'moderation_suspended',
        source: 'moderator',
        moderationReason: reason,
        suspensionEndsAt: endsAt,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      accountStatus: 'moderation_suspended',
      message: 'Conta suspensa pela moderação.',
    };
  }
);
