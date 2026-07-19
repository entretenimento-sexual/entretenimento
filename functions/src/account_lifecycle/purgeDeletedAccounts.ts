// functions/src/account_lifecycle/purgeDeletedAccounts.ts
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { auth, db, FieldValue } from '../firebaseApp';
import {
  ACCOUNT_LIFECYCLE_REGION,
  UserDoc,
  createLifecycleAudit,
  getNicknameIndexDocId,
  hashEmail,
} from './_shared';

const SCHEDULE = 'every day 03:17';
const TIME_ZONE = 'America/Sao_Paulo';
const BATCH_LIMIT = 200;

type PurgeCandidate = {
  uid: string;
  user: UserDoc;
  nicknameIndexDocId: string | null;
  emailHash: string | null;
};

export const purgeDeletedAccounts = onSchedule(
  {
    region: ACCOUNT_LIFECYCLE_REGION,
    schedule: SCHEDULE,
    timeZone: TIME_ZONE,
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async () => {
    const now = Date.now();
    const candidatesSnapshot = await db
      .collection('users')
      .where('purgeAfter', '<=', now)
      .limit(BATCH_LIMIT)
      .get();

    let processed = 0;
    let skipped = 0;
    let retryPending = 0;

    for (const userSnapshot of candidatesSnapshot.docs) {
      const candidate = toCandidate(
        userSnapshot.id,
        userSnapshot.data() as UserDoc
      );

      if (!isPurgeCandidate(candidate.user, now)) {
        skipped += 1;
        continue;
      }

      try {
        const claimed = await claimDeletion(candidate, now);
        if (!claimed) {
          skipped += 1;
          continue;
        }

        const authDeleted = await deleteAuthUser(candidate, now);
        if (!authDeleted) {
          retryPending += 1;
          continue;
        }

        const finalized = await finalizePrivateUserDeletion(candidate, now);
        if (finalized) {
          processed += 1;
        } else {
          retryPending += 1;
        }
      } catch (error) {
        retryPending += 1;
        console.error('[purgeDeletedAccounts] candidate failed', {
          uid: candidate.uid,
          error,
        });
      }
    }

    console.log('[purgeDeletedAccounts] summary', {
      scanned: candidatesSnapshot.size,
      processed,
      skipped,
      retryPending,
      now,
    });
  }
);

function toCandidate(uid: string, user: UserDoc): PurgeCandidate {
  return {
    uid,
    user,
    nicknameIndexDocId: getNicknameIndexDocId(user),
    emailHash: hashEmail(user.email),
  };
}

function isPurgeCandidate(user: UserDoc, now: number): boolean {
  const status = String(user.accountStatus ?? 'active');
  const purgeAfter = Number(user.purgeAfter ?? 0);

  return (
    (status === 'pending_deletion' || status === 'deleted') &&
    purgeAfter > 0 &&
    purgeAfter <= now &&
    user.legalHold !== true &&
    user.billingHold !== true
  );
}

/**
 * Fase 1: torna a exclusão irreversível para o fluxo do usuário e mantém o
 * documento privado como marcador de retry até Auth e finalização concluírem.
 */
async function claimDeletion(
  candidate: PurgeCandidate,
  now: number
): Promise<boolean> {
  return db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const userRef = db.collection('users').doc(candidate.uid);
    const publicProfileRef = db
      .collection('public_profiles')
      .doc(candidate.uid);
    const tombstoneRef = db
      .collection('deleted_accounts_audit')
      .doc(candidate.uid);
    const currentSnapshot = await tx.get(userRef);

    if (!currentSnapshot.exists) return false;

    const currentUser = (currentSnapshot.data() ?? {}) as UserDoc;
    if (!isPurgeCandidate(currentUser, now)) return false;

    const currentStatus = String(currentUser.accountStatus ?? 'active');

    if (currentStatus === 'pending_deletion') {
      tx.set(
        userRef,
        {
          accountStatus: 'deleted',
          publicVisibility: 'hidden',
          interactionBlocked: true,
          loginAllowed: false,
          deletedAt: now,
          purgeStartedAt: now,
          purgeAttemptCount: FieldValue.increment(1),
          statusUpdatedAt: now,
          statusUpdatedBy: 'system',
        },
        { merge: true }
      );

      tx.delete(publicProfileRef);
      if (candidate.nicknameIndexDocId) {
        tx.delete(
          db.collection('public_index').doc(candidate.nicknameIndexDocId)
        );
      }

      createLifecycleAudit(tx, {
        uid: candidate.uid,
        actorUid: 'system',
        action: 'mark_account_deleted',
        previousAccountStatus: 'pending_deletion',
        accountStatus: 'deleted',
        source: 'system',
        createdAt: now,
        updatedAt: now,
      });
    } else {
      tx.set(
        userRef,
        {
          purgeAttemptCount: FieldValue.increment(1),
          purgeLastAttemptAt: now,
        },
        { merge: true }
      );
    }

    tx.set(
      tombstoneRef,
      {
        uid: candidate.uid,
        status: 'deleted',
        source: currentUser.deletionRequestedBy ?? 'system',
        emailHash: candidate.emailHash,
        nickname: currentUser.nickname ?? null,
        deletionRequestedAt: currentUser.deletionRequestedAt ?? null,
        deletionUndoUntil: currentUser.deletionUndoUntil ?? null,
        deletedAt: currentUser.deletedAt ?? now,
        purgeAfter: currentUser.purgeAfter ?? now,
        legalHold: currentUser.legalHold ?? false,
        billingHold: currentUser.billingHold ?? false,
        authDeletionStatus: 'pending',
        firestoreDeletionStatus: 'pending',
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );

    return true;
  });
}

/** Fase 2: remove a credencial. Falhas permanecem retryable. */
async function deleteAuthUser(
  candidate: PurgeCandidate,
  now: number
): Promise<boolean> {
  try {
    await auth.deleteUser(candidate.uid);
  } catch (error: unknown) {
    const code = String(
      (error as { code?: unknown } | null)?.code ?? ''
    );

    if (code !== 'auth/user-not-found') {
      await db
        .collection('deleted_accounts_audit')
        .doc(candidate.uid)
        .set(
          {
            authDeletionStatus: 'failed',
            authDeletionErrorCode: code || 'unknown',
            authDeletionLastAttemptAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      return false;
    }
  }

  await db
    .collection('deleted_accounts_audit')
    .doc(candidate.uid)
    .set(
      {
        authDeletionStatus: 'success',
        authDeletionErrorCode: FieldValue.delete(),
        authDeletedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

  return true;
}

/**
 * Fase 3: apaga o documento privado somente depois da credencial. A transação é
 * retryable: se falhar, o usuário continua marcado como deleted e será encontrado
 * novamente pela query de purgeAfter.
 */
async function finalizePrivateUserDeletion(
  candidate: PurgeCandidate,
  now: number
): Promise<boolean> {
  return db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const userRef = db.collection('users').doc(candidate.uid);
    const tombstoneRef = db
      .collection('deleted_accounts_audit')
      .doc(candidate.uid);
    const currentSnapshot = await tx.get(userRef);

    if (!currentSnapshot.exists) {
      tx.set(
        tombstoneRef,
        {
          firestoreDeletionStatus: 'success',
          firestoreDeletedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      return true;
    }

    const currentUser = (currentSnapshot.data() ?? {}) as UserDoc;
    if (
      String(currentUser.accountStatus ?? '') !== 'deleted' ||
      currentUser.legalHold === true ||
      currentUser.billingHold === true
    ) {
      return false;
    }

    createLifecycleAudit(tx, {
      uid: candidate.uid,
      actorUid: 'system',
      action: 'purge_private_user_document',
      accountStatus: 'deleted',
      source: 'system',
      createdAt: now,
      updatedAt: now,
    });

    tx.set(
      tombstoneRef,
      {
        firestoreDeletionStatus: 'success',
        firestoreDeletedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    tx.delete(userRef);
    return true;
  });
}
