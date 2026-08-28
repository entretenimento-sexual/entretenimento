// functions/src/account_lifecycle/purgeDeletedAccounts.ts
import { randomUUID } from 'node:crypto';

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
import type {
  AccountDataDeletionExecutionSummary,
} from './account-data-deletion.executor';
import { executeAccountDataDeletionDomains } from './account-data-deletion.orchestrator';
import {
  ACCOUNT_DELETION_PURGE_LEASE_MS,
  AccountDeletionPurgePhase,
  buildAccountDeletionRetrySchedule,
  buildPurgeCandidateReference,
  isAccountDeletionLeaseAvailable,
  isAccountDeletionRetryDue,
  normalizePurgeAttemptCount,
  sanitizePurgeError,
} from './account-deletion-purge.policy';
import {
  FirestoreAccountDataDeletionFullAdapter,
} from './account-shared-message-anonymization.firestore';

const SCHEDULE = 'every 60 minutes';
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

const deletionAdapter = new FirestoreAccountDataDeletionFullAdapter();

type PurgeUserDoc = UserDoc & {
  purgeNextAttemptAt?: number | null;
  purgeLeaseOwner?: string | null;
  purgeLeaseUntil?: number | null;
  purgePhase?: AccountDeletionPurgePhase | null;
  purgeLastErrorCode?: string | null;
  purgeLastErrorCategory?: string | null;
  purgeLastErrorPhase?: AccountDeletionPurgePhase | null;
};

type PurgeCandidate = {
  uid: string;
  user: PurgeUserDoc;
  nicknameIndexDocId: string | null;
  emailHash: string | null;
  reference: string;
};

type PurgeClaim = {
  attemptCount: number;
};

type AuthDeletionResult =
  | { success: true }
  | { success: false; error: unknown };

type FinalizeDeletionResult = 'success' | 'retry';

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
    const executionId = randomUUID();
    const candidatesSnapshot = await db
      .collection('users')
      .where('purgeAfter', '<=', now)
      .limit(BATCH_LIMIT)
      .get();

    let processed = 0;
    let skipped = 0;
    let retryPending = 0;
    let blockedByPolicy = 0;
    let domainFailures = 0;

    for (const userSnapshot of candidatesSnapshot.docs) {
      const candidate = toCandidate(
        userSnapshot.id,
        userSnapshot.data() as PurgeUserDoc
      );

      if (!isPurgeCandidate(candidate.user, now)) {
        skipped += 1;
        continue;
      }

      let claim: PurgeClaim | null = null;

      try {
        claim = await claimDeletion(candidate, now, executionId);
        if (!claim) {
          skipped += 1;
          continue;
        }

        await markPurgePhase(
          candidate.uid,
          executionId,
          'auth_deletion',
          now
        );

        const authResult = await deleteAuthUser(candidate, now);
        if (!authResult.success) {
          await schedulePurgeRetry({
            candidate,
            executionId,
            attemptCount: claim.attemptCount,
            phase: 'auth_deletion',
            now,
            error: authResult.error,
          });
          retryPending += 1;
          continue;
        }

        await markPurgePhase(
          candidate.uid,
          executionId,
          'data_cleanup',
          now
        );

        const execution = await executeAccountDataDeletionDomains(
          deletionAdapter,
          {
            uid: candidate.uid,
            generatedAt: now,
          }
        );

        domainFailures += execution.results.filter(
          (result) => result.status === 'failed'
        ).length;

        const completedDomains = uniqueDomains([
          ...AUTH_COMPLETED_DOMAINS,
          ...execution.completedDomains,
        ]);
        const dataPlan = buildAccountDataDeletionPlan({
          uid: candidate.uid,
          generatedAt: now,
          completedDomains,
        });

        await persistDataDeletionPlan({
          candidate,
          executionId,
          plan: dataPlan,
          execution,
          now,
        });

        if (!canFinalizePrivateUserDeletion(dataPlan)) {
          await schedulePurgeRetry({
            candidate,
            executionId,
            attemptCount: claim.attemptCount,
            phase: 'blocked',
            now,
            error: { code: 'data-cleanup-incomplete' },
            blockingDomains: dataPlan.blockingDomains,
          });
          blockedByPolicy += 1;
          continue;
        }

        await markPurgePhase(
          candidate.uid,
          executionId,
          'finalization',
          now
        );

        const finalized = await finalizePrivateUserDeletion(
          candidate,
          dataPlan,
          executionId,
          now
        );

        if (finalized === 'success') {
          processed += 1;
        } else {
          await schedulePurgeRetry({
            candidate,
            executionId,
            attemptCount: claim.attemptCount,
            phase: 'finalization',
            now,
            error: { code: 'account-state-changed-during-finalization' },
          });
          retryPending += 1;
        }
      } catch (error: unknown) {
        retryPending += 1;
        const sanitized = sanitizePurgeError(error);

        if (claim) {
          try {
            await schedulePurgeRetry({
              candidate,
              executionId,
              attemptCount: claim.attemptCount,
              phase: 'retry_scheduled',
              now,
              error,
            });
          } catch (retryError: unknown) {
            const retrySanitized = sanitizePurgeError(retryError);
            console.error('[purgeDeletedAccounts] retry persistence failed', {
              candidateReference: candidate.reference,
              errorCode: retrySanitized.code,
              errorCategory: retrySanitized.category,
            });
          }
        }

        console.error('[purgeDeletedAccounts] candidate failed', {
          candidateReference: candidate.reference,
          errorCode: sanitized.code,
          errorCategory: sanitized.category,
        });
      }
    }

    console.log('[purgeDeletedAccounts] summary', {
      executionId,
      scanned: candidatesSnapshot.size,
      processed,
      skipped,
      retryPending,
      blockedByPolicy,
      domainFailures,
      policyVersion: ACCOUNT_DATA_RETENTION_POLICY_VERSION,
      now,
    });
  }
);

function toCandidate(uid: string, user: PurgeUserDoc): PurgeCandidate {
  return {
    uid,
    user,
    nicknameIndexDocId: getNicknameIndexDocId(user),
    emailHash: hashEmail(user.email),
    reference: buildPurgeCandidateReference(uid),
  };
}

function isPurgeCandidate(user: PurgeUserDoc, now: number): boolean {
  const status = String(user.accountStatus ?? 'active');
  const purgeAfter = Number(user.purgeAfter ?? 0);

  return (
    (status === 'pending_deletion' || status === 'deleted') &&
    purgeAfter > 0 &&
    purgeAfter <= now &&
    user.legalHold !== true &&
    user.billingHold !== true &&
    isAccountDeletionRetryDue(user, now)
  );
}

function uniqueDomains(
  domains: readonly AccountDataDomain[]
): AccountDataDomain[] {
  return [...new Set(domains)];
}

async function claimDeletion(
  candidate: PurgeCandidate,
  now: number,
  executionId: string
): Promise<PurgeClaim | null> {
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

    if (!currentSnapshot.exists) return null;

    const currentUser = (currentSnapshot.data() ?? {}) as PurgeUserDoc;
    if (
      !isPurgeCandidate(currentUser, now) ||
      !isAccountDeletionLeaseAvailable(currentUser, now, executionId)
    ) {
      return null;
    }

    const currentStatus = String(currentUser.accountStatus ?? 'active');
    const attemptCount = normalizePurgeAttemptCount(
      currentUser.purgeAttemptCount
    ) + 1;
    const leaseUntil = now + ACCOUNT_DELETION_PURGE_LEASE_MS;
    const operationalPatch = {
      purgeAttemptCount: attemptCount,
      purgeLastAttemptAt: now,
      purgeNextAttemptAt: FieldValue.delete(),
      purgeLeaseOwner: executionId,
      purgeLeaseUntil: leaseUntil,
      purgePhase: 'claimed' as AccountDeletionPurgePhase,
      purgeLastErrorCode: FieldValue.delete(),
      purgeLastErrorCategory: FieldValue.delete(),
      purgeLastErrorPhase: FieldValue.delete(),
      purgeBlockedReason: 'cleanup-in-progress',
      purgeBlockedDomains: claimPlan.blockingDomains,
    };

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
          statusUpdatedAt: now,
          statusUpdatedBy: 'system',
          ...operationalPatch,
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
      tx.set(userRef, operationalPatch, { merge: true });
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
        ...(currentStatus === 'pending_deletion'
          ? {
            authDeletionStatus: 'pending',
            firestoreDeletionStatus: 'pending',
          }
          : {}),
        purgeAttemptCount: attemptCount,
        purgeLastAttemptAt: now,
        purgeNextAttemptAt: FieldValue.delete(),
        purgeLeaseOwner: executionId,
        purgeLeaseUntil: leaseUntil,
        purgePhase: 'claimed',
        purgeLastErrorCode: FieldValue.delete(),
        purgeLastErrorCategory: FieldValue.delete(),
        purgeLastErrorPhase: FieldValue.delete(),
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

    return { attemptCount };
  });
}

async function markPurgePhase(
  uid: string,
  executionId: string,
  phase: AccountDeletionPurgePhase,
  now: number
): Promise<void> {
  await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const userRef = db.collection('users').doc(uid);
    const tombstoneRef = db.collection('deleted_accounts_audit').doc(uid);
    const userSnapshot = await tx.get(userRef);

    if (userSnapshot.exists) {
      const user = (userSnapshot.data() ?? {}) as PurgeUserDoc;
      if (String(user.purgeLeaseOwner ?? '') !== executionId) {
        throw Object.assign(new Error('Purge lease ownership lost.'), {
          code: 'purge/lease-lost',
        });
      }
      tx.update(userRef, {
        purgePhase: phase,
        purgeLastAttemptAt: now,
      });
    }

    tx.set(
      tombstoneRef,
      {
        purgePhase: phase,
        purgeLastAttemptAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  });
}

async function deleteAuthUser(
  candidate: PurgeCandidate,
  now: number
): Promise<AuthDeletionResult> {
  try {
    await auth.deleteUser(candidate.uid);
  } catch (error: unknown) {
    const sanitized = sanitizePurgeError(error);

    if (sanitized.code !== 'auth/user-not-found') {
      await db
        .collection('deleted_accounts_audit')
        .doc(candidate.uid)
        .set(
          {
            authDeletionStatus: 'failed',
            authDeletionErrorCode: sanitized.code,
            authDeletionErrorCategory: sanitized.category,
            authDeletionLastAttemptAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      return { success: false, error };
    }
  }

  await db
    .collection('deleted_accounts_audit')
    .doc(candidate.uid)
    .set(
      {
        authDeletionStatus: 'success',
        authDeletionErrorCode: FieldValue.delete(),
        authDeletionErrorCategory: FieldValue.delete(),
        authDeletedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

  return { success: true };
}

async function persistDataDeletionPlan(input: {
  candidate: PurgeCandidate;
  executionId: string;
  plan: AccountDataDeletionPlan;
  execution: AccountDataDeletionExecutionSummary;
  now: number;
}): Promise<void> {
  const { candidate, executionId, plan, execution, now } = input;
  const batch = db.batch();
  const userRef = db.collection('users').doc(candidate.uid);
  const tombstoneRef = db
    .collection('deleted_accounts_audit')
    .doc(candidate.uid);
  const executionAuditRef = db
    .collection('account_data_deletion_audit')
    .doc();

  batch.set(
    tombstoneRef,
    {
      purgePhase: 'data_cleanup',
      dataRetentionPolicyVersion: plan.policyVersion,
      dataDeletionStatus: plan.status,
      dataDeletionCompletedDomains: plan.completedDomains,
      dataDeletionBlockers: plan.blockingDomains,
      dataDeletionPlan: plan.steps,
      dataDeletionDomainProgress: execution.results,
      dataDeletionLastPlannedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  batch.update(userRef, {
    purgePhase: 'data_cleanup',
    purgeLastAttemptAt: now,
    purgeBlockedReason:
      plan.status === 'blocked'
        ? 'data-cleanup-incomplete'
        : FieldValue.delete(),
    purgeBlockedDomains:
      plan.status === 'blocked'
        ? plan.blockingDomains
        : FieldValue.delete(),
  });

  batch.set(executionAuditRef, {
    uid: candidate.uid,
    candidateReference: candidate.reference,
    executionId,
    policyVersion: plan.policyVersion,
    planStatus: plan.status,
    completedDomains: plan.completedDomains,
    blockingDomains: plan.blockingDomains,
    domainResults: execution.results,
    createdAt: now,
    source: 'scheduled-account-purge',
  });

  await batch.commit();
}

async function finalizePrivateUserDeletion(
  candidate: PurgeCandidate,
  plan: AccountDataDeletionPlan,
  executionId: string,
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
          purgePhase: 'completed',
          purgeLeaseOwner: FieldValue.delete(),
          purgeLeaseUntil: FieldValue.delete(),
          purgeNextAttemptAt: FieldValue.delete(),
          firestoreDeletionStatus: 'success',
          firestoreDeletedAt: now,
          dataDeletionStatus: 'ready',
          dataDeletionBlockers: [],
          updatedAt: now,
        },
        { merge: true }
      );
      return 'success';
    }

    const currentUser = (currentSnapshot.data() ?? {}) as PurgeUserDoc;
    if (
      String(currentUser.accountStatus ?? '') !== 'deleted' ||
      currentUser.legalHold === true ||
      currentUser.billingHold === true ||
      String(currentUser.purgeLeaseOwner ?? '') !== executionId ||
      !canFinalizePrivateUserDeletion(plan)
    ) {
      return 'retry';
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
        purgePhase: 'completed',
        purgeLeaseOwner: FieldValue.delete(),
        purgeLeaseUntil: FieldValue.delete(),
        purgeNextAttemptAt: FieldValue.delete(),
        purgeLastErrorCode: FieldValue.delete(),
        purgeLastErrorCategory: FieldValue.delete(),
        purgeLastErrorPhase: FieldValue.delete(),
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

async function schedulePurgeRetry(input: {
  candidate: PurgeCandidate;
  executionId: string;
  attemptCount: number;
  phase: AccountDeletionPurgePhase;
  now: number;
  error: unknown;
  blockingDomains?: readonly AccountDataDomain[];
}): Promise<void> {
  const {
    candidate,
    executionId,
    attemptCount,
    phase,
    now,
    error,
    blockingDomains = [],
  } = input;
  const retry = buildAccountDeletionRetrySchedule({ attemptCount, now });
  const sanitized = sanitizePurgeError(error);
  const retryPhase: AccountDeletionPurgePhase = phase === 'blocked'
    ? 'blocked'
    : 'retry_scheduled';

  await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const userRef = db.collection('users').doc(candidate.uid);
    const tombstoneRef = db
      .collection('deleted_accounts_audit')
      .doc(candidate.uid);
    const userSnapshot = await tx.get(userRef);

    if (userSnapshot.exists) {
      const user = (userSnapshot.data() ?? {}) as PurgeUserDoc;
      const leaseOwner = String(user.purgeLeaseOwner ?? '');

      if (leaseOwner && leaseOwner !== executionId) {
        throw Object.assign(new Error('Purge lease ownership lost.'), {
          code: 'purge/lease-lost',
        });
      }

      tx.update(userRef, {
        purgePhase: retryPhase,
        purgeNextAttemptAt: retry.retryAt,
        purgeLeaseOwner: FieldValue.delete(),
        purgeLeaseUntil: FieldValue.delete(),
        purgeLastErrorCode: sanitized.code,
        purgeLastErrorCategory: sanitized.category,
        purgeLastErrorPhase: phase,
        purgeBlockedReason:
          phase === 'blocked'
            ? 'data-cleanup-incomplete'
            : 'retry-scheduled',
        purgeBlockedDomains: blockingDomains,
        purgeLastAttemptAt: now,
      });
    }

    tx.set(
      tombstoneRef,
      {
        purgePhase: retryPhase,
        purgeAttemptCount: retry.attemptCount,
        purgeNextAttemptAt: retry.retryAt,
        purgeRetryDelayMs: retry.delayMs,
        purgeLeaseOwner: FieldValue.delete(),
        purgeLeaseUntil: FieldValue.delete(),
        purgeLastErrorCode: sanitized.code,
        purgeLastErrorCategory: sanitized.category,
        purgeLastErrorPhase: phase,
        dataDeletionBlockers: blockingDomains,
        updatedAt: now,
      },
      { merge: true }
    );
  });
}
