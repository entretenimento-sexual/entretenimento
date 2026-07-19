// functions/src/account_lifecycle/moderateScheduleDeletion.ts
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

interface ModerateScheduleDeletionRequest {
  targetUid: string;
  reason: string;
  undoWindowMs?: number | null;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: 'pending_deletion';
  deletionUndoUntil: number;
  purgeAfter: number;
  message: string;
}

const DEFAULT_UNDO_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MIN_UNDO_WINDOW_MS = 60 * 60 * 1_000;
const MAX_UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

function normalizeOptionalWindow(value?: number | null): number {
  if (value == null) return DEFAULT_UNDO_WINDOW_MS;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpsError(
      'invalid-argument',
      'Janela de exclusão inválida.'
    );
  }

  const normalized = Math.trunc(value);
  if (
    normalized < MIN_UNDO_WINDOW_MS ||
    normalized > MAX_UNDO_WINDOW_MS
  ) {
    throw new HttpsError(
      'invalid-argument',
      'A janela de exclusão deve ficar entre uma hora e 30 dias.'
    );
  }

  return normalized;
}

export const moderateScheduleDeletion = onCall<ModerateScheduleDeletionRequest>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const actorUid = request.auth?.uid ?? null;
    const authToken = (request.auth?.token ?? {}) as Record<string, unknown>;

    assertRecentAuthentication(authToken);
    await assertStaffAuthorization({
      actorUid,
      authToken,
      requiredPermission: 'users:delete',
    });

    const targetUid = normalizeUid(request.data?.targetUid);
    const reason = normalizeRequiredReason(request.data?.reason);
    const undoWindowMs = normalizeOptionalWindow(
      request.data?.undoWindowMs
    );
    const now = Date.now();
    const deletionUndoUntil = now + undoWindowMs;

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'UID alvo inválido.');
    }

    if (targetUid === actorUid) {
      throw new HttpsError(
        'failed-precondition',
        'A moderação não pode alterar o próprio lifecycle por este fluxo.'
      );
    }

    const schedule = await db.runTransaction(
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

        if (currentStatus === 'pending_deletion') {
          if (user.deletionRequestedBy !== 'moderator') {
            throw new HttpsError(
              'failed-precondition',
              'Já existe uma exclusão solicitada por outro fluxo.'
            );
          }

          const currentUndoUntil = Number(user.deletionUndoUntil ?? 0);
          const currentPurgeAfter = Number(user.purgeAfter ?? 0);
          if (!currentUndoUntil || !currentPurgeAfter) {
            throw new HttpsError(
              'data-loss',
              'O agendamento de exclusão está inconsistente.'
            );
          }

          return {
            deletionUndoUntil: currentUndoUntil,
            purgeAfter: currentPurgeAfter,
          };
        }

        const nicknameIndexDocId = getNicknameIndexDocId(user);

        tx.set(
          userRef,
          {
            accountStatus: 'pending_deletion',
            publicVisibility: 'hidden',
            interactionBlocked: true,
            loginAllowed: true,
            suspended: false,
            suspensionReason: null,
            suspensionSource: null,
            suspensionEndsAt: null,
            deletionRequestedAt: now,
            deletionRequestedBy: 'moderator',
            deletionUndoUntil,
            purgeAfter: deletionUndoUntil,
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
          action: 'moderate_schedule_deletion',
          previousAccountStatus: currentStatus,
          accountStatus: 'pending_deletion',
          source: 'moderator',
          moderationReason: reason,
          deletionRequestedAt: now,
          deletionUndoUntil,
          purgeAfter: deletionUndoUntil,
          createdAt: now,
          updatedAt: now,
        });

        return {
          deletionUndoUntil,
          purgeAfter: deletionUndoUntil,
        };
      }
    );

    return {
      ok: true,
      accountStatus: 'pending_deletion',
      ...schedule,
      message: 'Exclusão da conta agendada pela moderação.',
    };
  }
);
