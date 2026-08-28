// functions/src/account_lifecycle/getAccountDeletionOperations.ts
// -----------------------------------------------------------------------------
// ADMIN ACCOUNT DELETION OPERATIONS CALLABLE
// -----------------------------------------------------------------------------
// Retorna somente projeções técnicas sanitizadas para acompanhamento do purge.
// Não expõe UID, e-mail, emailHash, payloads de domínio ou mensagens de erro.
// -----------------------------------------------------------------------------
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
import { ACCOUNT_LIFECYCLE_REGION } from './_shared';
import {
  hasAccountDeletionOperationsPermission,
} from './account-deletion-operations.authorization';
import {
  cursorForAccountDeletionOperation,
  mapAccountDeletionOperation,
  matchesAccountDeletionOperationFilter,
  normalizeAccountDeletionOperationsRequest,
  type AccountDeletionOperationItem,
  type AccountDeletionOperationsCursor,
} from './account-deletion-operations.model';

interface AccountDeletionOperationsMetrics {
  total: number;
  attention: number;
  inProgress: number;
  blocked: number;
  retryScheduled: number;
  completed: number;
}

interface AccountDeletionOperationsResponse {
  items: AccountDeletionOperationItem[];
  metrics: AccountDeletionOperationsMetrics;
  nextCursor: AccountDeletionOperationsCursor | null;
  hasMore: boolean;
  generatedAt: number;
}

const COLLECTION = 'deleted_accounts_audit';
const SCAN_MULTIPLIER = 5;
const MAX_SCAN_LIMIT = 250;
const CURSOR_COLLISION_BUFFER = 250;

export const getAccountDeletionOperations = onCall<unknown>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountDeletionOperationsResponse> => {
    const actorUid = request.auth?.uid ?? null;
    const authToken = request.auth?.token as
      | Record<string, unknown>
      | undefined;

    await assertAccountDeletionOperationsAccess(actorUid, authToken);

    const input = normalizeAccountDeletionOperationsRequest(request.data);
    const collection = db.collection(COLLECTION);
    const scanLimit = Math.min(
      Math.max(input.limit * SCAN_MULTIPLIER, input.limit),
      MAX_SCAN_LIMIT
    );
    const queryLimit = scanLimit + (input.cursor ? CURSOR_COLLISION_BUFFER : 0);
    let query: FirebaseFirestore.Query = collection
      .orderBy('updatedAt', 'desc')
      .limit(queryLimit);

    if (input.cursor) {
      query = query.startAt(input.cursor.updatedAt);
    }

    const [snapshot, metrics] = await Promise.all([
      query.get(),
      loadMetrics(),
    ]);
    const availableDocuments = resolveDocumentsAfterCursor(
      snapshot.docs,
      input.cursor
    ).slice(0, scanLimit);
    const selectedItems: AccountDeletionOperationItem[] = [];
    let cursorItem: AccountDeletionOperationItem | null = null;
    let cursorDocumentIndex = -1;

    for (let index = 0; index < availableDocuments.length; index += 1) {
      const document = availableDocuments[index];
      const item = mapAccountDeletionOperation(document.id, document.data());
      cursorItem = item;
      cursorDocumentIndex = index;

      if (matchesAccountDeletionOperationFilter(item, input.filter)) {
        selectedItems.push(item);
        if (selectedItems.length >= input.limit) break;
      }
    }

    const scannedAllAvailable =
      cursorDocumentIndex >= availableDocuments.length - 1;
    const sourceMayHaveMore = snapshot.size >= queryLimit;
    const hasUnscannedDocuments =
      cursorDocumentIndex >= 0 && !scannedAllAvailable;
    const hasMore =
      cursorItem !== null && (hasUnscannedDocuments || sourceMayHaveMore);

    return {
      items: selectedItems,
      metrics,
      nextCursor: hasMore && cursorItem
        ? cursorForAccountDeletionOperation(cursorItem)
        : null,
      hasMore,
      generatedAt: Date.now(),
    };
  }
);

async function assertAccountDeletionOperationsAccess(
  actorUid: string | null,
  authToken: Record<string, unknown> | undefined
): Promise<void> {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (hasAccountDeletionOperationsPermission(authToken)) return;

  const actorSnapshot = await db.collection('users').doc(actorUid).get();
  if (
    actorSnapshot.exists &&
    hasAccountDeletionOperationsPermission(actorSnapshot.data())
  ) {
    return;
  }

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão para consultar operações de exclusão.'
  );
}

function resolveDocumentsAfterCursor(
  documents: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  cursor: AccountDeletionOperationsCursor | null
): FirebaseFirestore.QueryDocumentSnapshot[] {
  if (!cursor) return [...documents];

  const cursorIndex = documents.findIndex((document) => {
    const item = mapAccountDeletionOperation(document.id, document.data());
    return (
      item.reference === cursor.reference &&
      item.updatedAt === cursor.updatedAt
    );
  });

  if (cursorIndex < 0) {
    throw new HttpsError(
      'failed-precondition',
      'A página solicitada não está mais disponível. Atualize a consulta.',
      { reason: 'account-deletion-operations-cursor-expired' }
    );
  }

  return documents.slice(cursorIndex + 1);
}

async function loadMetrics(): Promise<AccountDeletionOperationsMetrics> {
  const collection = db.collection(COLLECTION);
  const [total, blocked, retryScheduled, inProgress, completed] =
    await Promise.all([
      collection.count().get(),
      collection.where('purgePhase', '==', 'blocked').count().get(),
      collection
        .where('purgePhase', '==', 'retry_scheduled')
        .count()
        .get(),
      collection
        .where('purgePhase', 'in', [
          'claimed',
          'auth_deletion',
          'data_cleanup',
          'finalization',
        ])
        .count()
        .get(),
      collection.where('purgePhase', '==', 'completed').count().get(),
    ]);
  const blockedCount = normalizeMetricCount(blocked.data().count);
  const retryCount = normalizeMetricCount(retryScheduled.data().count);

  return {
    total: normalizeMetricCount(total.data().count),
    attention: blockedCount + retryCount,
    inProgress: normalizeMetricCount(inProgress.data().count),
    blocked: blockedCount,
    retryScheduled: retryCount,
    completed: normalizeMetricCount(completed.data().count),
  };
}

function normalizeMetricCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
