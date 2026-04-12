//functions\src\account_lifecycle\purgeDeletedAccounts.ts
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { auth, db } from '../firebaseApp';
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

    const candidatesSnap = await db
      .collection('users')
      .where('purgeAfter', '<=', now)
      .limit(BATCH_LIMIT)
      .get();

    let processed = 0;
    let skipped = 0;

    for (const userDocSnap of candidatesSnap.docs) {
      const uid = userDocSnap.id;
      const user = (userDocSnap.data() ?? {}) as UserDoc;

      const accountStatus = String(user.accountStatus ?? 'active');
      const purgeAfter = Number(user.purgeAfter ?? 0);
      const legalHold = user.legalHold === true;
      const billingHold = user.billingHold === true;

      if (
        accountStatus !== 'pending_deletion' ||
        !purgeAfter ||
        purgeAfter > now ||
        legalHold ||
        billingHold
      ) {
        skipped += 1;
        continue;
      }

      const nicknameIndexDocId = getNicknameIndexDocId(user);
      const emailHash = hashEmail(user.email);

      try {
        await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
          const userRef = db.collection('users').doc(uid);
          const publicProfileRef = db.collection('public_profiles').doc(uid);
          const tombstoneRef = db.collection('deleted_accounts_audit').doc(uid);

          const currentSnap = await tx.get(userRef);
          if (!currentSnap.exists) {
            return;
          }

          const currentUser = (currentSnap.data() ?? {}) as UserDoc;
          const currentStatus = String(currentUser.accountStatus ?? 'active');
          const currentPurgeAfter = Number(currentUser.purgeAfter ?? 0);

          if (
            currentStatus !== 'pending_deletion' ||
            !currentPurgeAfter ||
            currentPurgeAfter > now ||
            currentUser.legalHold === true ||
            currentUser.billingHold === true
          ) {
            return;
          }

            tx.set(
            tombstoneRef,
            {
                uid,
                status: 'deleted',
                source: currentUser.deletionRequestedBy ?? 'system',
                moderationReason: currentUser.suspensionReason ?? null,
                emailHash,
                nickname: currentUser.nickname ?? null,
                deletionRequestedAt: currentUser.deletionRequestedAt ?? null,
                deletionUndoUntil: currentUser.deletionUndoUntil ?? null,
                deletedAt: now,
                purgeAfter: currentUser.purgeAfter ?? now,
                legalHold: currentUser.legalHold ?? false,
                billingHold: currentUser.billingHold ?? false,
                authDeletionStatus: 'pending',
                createdAt: now,
                updatedAt: now,
            },
            { merge: true }
);

          tx.delete(publicProfileRef);

          if (nicknameIndexDocId) {
            const nicknameIndexRef = db.collection('public_index').doc(nicknameIndexDocId);
            tx.delete(nicknameIndexRef);
          }

          createLifecycleAudit(tx, {
            uid,
            actorUid: 'system',
            action: 'purge_deleted_account',
            accountStatus: 'deleted',
            source: 'system',
            moderationReason: currentUser.suspensionReason ?? null,
            createdAt: now,
            updatedAt: now,
          });

          tx.delete(userRef);
        });

        try {
          await auth.deleteUser(uid);

          await db.collection('deleted_accounts_audit').doc(uid).set(
            {
              authDeletionStatus: 'success',
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        } catch (authErr: any) {
          const authCode = String(authErr?.code ?? '');

          if (authCode !== 'auth/user-not-found') {
            await db.collection('deleted_accounts_audit').doc(uid).set(
              {
                authDeletionStatus: 'failed',
                authDeletionErrorCode: authCode || 'unknown',
                updatedAt: Date.now(),
              },
              { merge: true }
            );
          } else {
            await db.collection('deleted_accounts_audit').doc(uid).set(
              {
                authDeletionStatus: 'success',
                updatedAt: Date.now(),
              },
              { merge: true }
            );
          }
        }

        processed += 1;
      } catch (err) {
        skipped += 1;
        console.error('[purgeDeletedAccounts] failed', { uid, err });
      }
    }

    console.log('[purgeDeletedAccounts] summary', {
      scanned: candidatesSnap.size,
      processed,
      skipped,
      now,
    });
  }
);