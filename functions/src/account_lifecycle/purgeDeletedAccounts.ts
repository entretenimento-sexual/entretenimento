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
import {
  ACCOUNT_DATA_RETENTION_POLICY_VERSION,
  AccountDataDeletionPlan,
  AccountDataDomain,
  buildAccountDataDeletionPlan,
  canFinalizePrivateUserDeletion,
} from './account-data-retention.policy';

const SCHEDULE = 'every day 03:17';
const TIME_ZONE = 'America/Sao_Paulo';
const BATCH_LIMIT = 200;

const CLAIM_COMPLETED_DOMAINS: readonly AccountDataDomain[] = [
  'public_profile',
  'nickname_index',
];

const AUTH_COMPLETED_DOMAINS: readonly AccountDataDomain[] = [
  ...CLAIM_COMPLETED_DOMAINS,
  'auth_identity',
];

type PurgeCandidate = {
  uid: string;
  user: UserDoc;
  nicknameIndexDocId: string | null;
  emailHash: string | null;
};

type FinalizeDeletionResult = 'success' | 'blocked' | 'retry';

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
    let blockedByPolicy = 0;

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

        const dataPlan = buildAccountDataDeletionPlan({
          uid: candidate.uid,
          generatedAt: now,
          completedDomains: AUTH_COMPLETED_DOMAINS,
        });

        await persistDataDeletionPlan(candidate, dataPlan, now);

        const finalized = await finalizePrivateUserDeletion(
          candidate,
          dataPlan,
          now
        );

        if (finalized === 'success') {
          processed += 1;
        } else if (finalized === 'blocked') {
          blockedByPolicy += 1;
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
      blockedByPolicy,
      policyVersion: ACCOUNT_DATA_RETENTION_POLICY_VERSION,
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
 * Fase 1: torna a exclusão irreversível para o fluxo do usuário, remove a
 * projeção pública e registra o primeiro plano de retenção no tombstone.
 */
async function claimDeletion(
  candidate: PurgeCandidate,
  now: number
): Promise<boolean> {
  const claimPlan = buildAccountDataDeletionPlan({
    uid: candidate.uid,
    generatedAt: now,
    completedDomains: CLAIM_COMPLETED_DOMAINS,
  });

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
          purgeBlockedReason: 'data-contract-required',
          purgeBlockedDomains: claimPlan.blockingDomains,
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
          purgeBlockedReason: 'data-contract-required',
          purgeBlockedDomains: claimPlan.blockingDomains,
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
        nickname: FieldValue.delete(),
        deletionRequestedAt: currentUser.deletionRequestedAt ?? null,
        deletionUndoUntil: currentUser.deletionUndoUntil ?? null,
        deletedAt: currentUser.deletedAt ?? now,
        purgeAfter: currentUser.purgeAfter ?? now,
        legalHold: currentUser.legalHold ?? false,
        billingHold: currentUser.billingHold ?? false,
        authDeletionStatus: 'pending',
        firestoreDeletionStatus: 'pending',
        dataRetentionPolicyVersion: claimPlan.policyVersion,
        dataDeletionStatus: claimPlan.status,
        dataDeletionCompletedDomains: claimPlan.completedDomains,
        dataDeletionBlockers: claimPlan.blockingDomains,
        dataDeletionPlan: claimPlan.steps,
        dataDeletionLastPlannedAt: now,
        updatedAt: now,
        createdAt: currentUser.purgeStartedAt ?? now,
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

async function persistDataDeletionPlan(
  candidate: PurgeCandidate,
  plan: AccountDataDeletionPlan,
  now: number
): Promise<void> {
  const batch = db.batch();
  const userRef = db.collection('users').doc(candidate.uid);
  const tombstoneRef = db
    .collection('deleted_accounts_audit')
    .doc(candidate.uid);

  batch.set(
    tombstoneRef,
    {
      dataRetentionPolicyVersion: plan.policyVersion,
      dataDeletionStatus: plan.status,
      dataDeletionCompletedDomains: plan.completedDomains,
      dataDeletionBlockers: plan.blockingDomains,
      dataDeletionPlan: plan.steps,
      dataDeletionLastPlannedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  batch.set(
    userRef,
    {
      purgeLastAttemptAt: now,
      purgeBlockedReason: plan.status === 'blocked'
        ? 'data-contract-required'
        : FieldValue.delete(),
      purgeBlockedDomains: plan.status === 'blocked'
        ? plan.blockingDomains
        : FieldValue.delete(),
    },
    { merge: true }
  );

  await batch.commit();
}

/**
 * Fase 3: remove users/{uid} somente quando a matriz de dados confirmar que
 * todas as etapas pre_finalize estão concluídas. Enquanto houver contratos
 * pendentes, o documento privado permanece como marcador de retry e auditoria.
 */
async function finalizePrivateUserDeletion(
  candidate: PurgeCandidate,
  plan: AccountDataDeletionPlan,
  now: number
): Promise<FinalizeDeletionResult> {
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
          dataDeletionStatus: 'ready',
          updatedAt: now,
        },
        { merge: true }
      );
      return 'success';
    }

    const currentUser = (currentSnapshot.data() ?? {}) as UserDoc;
    if (
      String(currentUser.accountStatus ?? '') !== 'deleted' ||
      currentUser.legalHold === true ||
      currentUser.billingHold === true
    ) {
      return 'retry';
    }

    if (!canFinalizePrivateUserDeletion(plan)) {
      tx.set(
        userRef,
        {
          purgeLastAttemptAt: now,
          purgeBlockedReason: 'data-contract-required',
          purgeBlockedDomains: plan.blockingDomains,
        },
        { merge: true }
      );
      tx.set(
        tombstoneRef,
        {
          firestoreDeletionStatus: 'blocked',
          dataDeletionStatus: 'blocked',
          dataDeletionBlockers: plan.blockingDomains,
          dataDeletionLastCheckedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      return 'blocked';
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
        dataDeletionStatus: 'ready',
        dataDeletionBlockers: [],
        updatedAt: now,
      },
      { merge: true }
    );
    tx.delete(userRef);
    return 'success';
  });
}
