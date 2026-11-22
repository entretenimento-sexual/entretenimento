import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../firebaseApp';
import {
  isAccountDeletionLeaseAvailable,
  isAccountDeletionRetryDue,
  type AccountDeletionPurgeOperationalState,
} from './account-deletion-purge.policy';

const PAGE_LIMIT = 200;
const SCAN_LIMIT = 1_000;
const WORK_LIMIT = 200;

interface PurgeQueueEntry extends AccountDeletionPurgeOperationalState {
  accountStatus?: unknown;
  purgeAfter?: unknown;
  legalHold?: unknown;
  billingHold?: unknown;
}

interface ScanCursor {
  cutoffAt: number;
  purgeAfter: number;
  uid: string;
}

export function isPurgeCandidate(user: PurgeQueueEntry, now: number): boolean {
  // Um perfil incompleto, por si só, nunca agenda uma exclusão.
  const purgeAfter = Number(user.purgeAfter ?? 0);
  return (
    (user.accountStatus === 'pending_deletion' || user.accountStatus === 'deleted') &&
    purgeAfter > 0 &&
    purgeAfter <= now &&
    user.legalHold !== true &&
    user.billingHold !== true &&
    isAccountDeletionRetryDue(user, now)
  );
}

function readCursor(value: unknown): ScanCursor | null {
  if (!value || typeof value !== 'object') return null;
  const { cutoffAt, purgeAfter, uid } = value as Partial<ScanCursor>;
  if (typeof cutoffAt !== 'number' || !Number.isFinite(cutoffAt) ||
      typeof purgeAfter !== 'number' || !Number.isFinite(purgeAfter) ||
      purgeAfter <= 0 || purgeAfter > cutoffAt ||
      typeof uid !== 'string' || !uid || uid.includes('/')) return null;
  return { cutoffAt, purgeAfter, uid };
}

export async function reserveAccountDeletionPurgeBatch(now: number): Promise<{
  candidates: FirebaseFirestore.QueryDocumentSnapshot[];
  scanned: number;
  skipped: number;
  resumed: boolean;
  exhausted: boolean;
} | null> {
  const checkpointRef = db.doc('account_deletion_purge_state/scan');
  const checkpoint = await checkpointRef.get();
  let cursor = readCursor(checkpoint.get('cursor'));
  const resumed = cursor !== null;
  // Congela o limite da volta. Novos vencimentos não prolongam a mesma varredura.
  const cutoffAt = cursor?.cutoffAt ?? now;
  const baseQuery = db.collection('users')
    .where('purgeAfter', '>', 0)
    .where('purgeAfter', '<=', cutoffAt)
    .orderBy('purgeAfter')
    .orderBy(FieldPath.documentId())
    .select('accountStatus', 'purgeAfter', 'legalHold', 'billingHold',
      'purgeNextAttemptAt', 'purgeLeaseOwner', 'purgeLeaseUntil', 'email');

  const candidates: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let scanned = 0;
  let exhausted = false;

  while (scanned < SCAN_LIMIT && candidates.length < WORK_LIMIT) {
    const pageSize = Math.min(PAGE_LIMIT, SCAN_LIMIT - scanned);
    const pageQuery = cursor ? baseQuery.startAfter(cursor.purgeAfter, cursor.uid) : baseQuery;
    const page = await pageQuery.limit(pageSize).get();
    let examined = 0;

    for (const doc of page.docs) {
      const user = doc.data();
      cursor = { cutoffAt, purgeAfter: user['purgeAfter'] as number, uid: doc.id };
      examined += 1;
      scanned += 1;
      if (isPurgeCandidate(user, now) && isAccountDeletionLeaseAvailable(user, now, '')) {
        candidates.push(doc);
        if (candidates.length === WORK_LIMIT) break;
      }
    }

    if (examined === page.size && page.size < pageSize) {
      exhausted = true;
      cursor = null;
      break;
    }
  }

  // Avança antes do trabalho pesado. Uma interrupção deixa as contas no índice
  // original, onde voltam a ser encontradas na próxima volta da fila.
  if (cursor || resumed || candidates.length > 0) {
    const saved = await db.runTransaction(async (tx) => {
      const current = await tx.get(checkpointRef);
      if (checkpoint.exists !== current.exists ||
          (checkpoint.updateTime && (!current.updateTime ||
            !checkpoint.updateTime.isEqual(current.updateTime)))) return false;
      tx.set(checkpointRef, { cursor, scannedAt: now });
      return true;
    });
    if (!saved) return null;
  }

  return { candidates, scanned, skipped: scanned - candidates.length, resumed, exhausted };
}
