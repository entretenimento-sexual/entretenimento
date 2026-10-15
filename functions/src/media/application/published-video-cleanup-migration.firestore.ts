import { FieldPath, type Firestore } from 'firebase-admin/firestore';

import { resolveVideoCleanupJobScheduling } from './video-cleanup-job.policy';

const DEFAULT_CLEANUP_COLLECTION = 'media_published_video_asset_cleanup_jobs';
const MIGRATION_PROGRESS_COLLECTION = 'media_cleanup_migration_state';
const DEFAULT_MIGRATION_ID = 'published-video-asset-v1';
const MAX_MIGRATION_BATCH_SIZE = 100;

export interface PublishedVideoCleanupMigrationOptions {
  /** Alternate disposable collections are only for isolated emulator tests. */
  cleanupCollection?: string;
  migrationId?: string;
  batchSize?: number;
  now?: number;
}

export interface PublishedVideoCleanupMigrationResult {
  scanned: number;
  checkpointAdvanced: boolean;
  complete: boolean;
}

/**
 * Incrementally backfill old cleanup jobs whose nextAttemptAt is absent.
 * The checkpoint is published only after every migration transaction succeeds.
 * A stale concurrent invoker must never overwrite a newer cursor/completion.
 */
export async function migrateLegacyPublishedVideoCleanupJobs(
  firestore: Firestore,
  options: PublishedVideoCleanupMigrationOptions = {}
): Promise<PublishedVideoCleanupMigrationResult> {
  const collectionName = options.cleanupCollection ?? DEFAULT_CLEANUP_COLLECTION;
  const migrationId = options.migrationId ?? DEFAULT_MIGRATION_ID;
  const batchSize = options.batchSize ?? MAX_MIGRATION_BATCH_SIZE;
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_MIGRATION_BATCH_SIZE ||
      !Number.isFinite(now)) {
    throw new Error('Invalid video cleanup migration bounds.');
  }

  const progressRef = firestore.collection(MIGRATION_PROGRESS_COLLECTION).doc(migrationId);
  const progressSnap = await progressRef.get();
  const progress = progressSnap.exists ? progressSnap.data() : null;
  if (progress?.['complete'] === true) {
    return { scanned: 0, checkpointAdvanced: false, complete: true };
  }

  const lastDocumentId = typeof progress?.['lastDocumentId'] === 'string'
    ? progress['lastDocumentId'] : '';
  let query = firestore.collection(collectionName)
    .orderBy(FieldPath.documentId()).limit(batchSize);
  if (lastDocumentId) query = query.startAfter(lastDocumentId);
  const snapshot = await query.get();

  // Transactions are idempotent: a retry after partial execution is safe.
  // Keep concurrency bounded to avoid Firestore write spikes.
  for (let i = 0; i < snapshot.docs.length; i += 5) {
    const page = snapshot.docs.slice(i, i + 5);
    await Promise.all(page.map((doc) => firestore.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (!current.exists) return;
      const decision = resolveVideoCleanupJobScheduling(current.data() ?? {}, now);
      if (!decision.requiresMigration) return;
      tx.set(doc.ref, {
        state: decision.state,
        nextAttemptAt: decision.nextAttemptAt,
        deadLetterExpiresAt: null,
        updatedAt: now,
      }, { merge: true });
    })));
  }

  const nextDocumentId = snapshot.docs.at(-1)?.id ?? lastDocumentId;
  const completesPage = snapshot.size < batchSize;
  const advanced = await firestore.runTransaction(async (tx) => {
    const currentSnap = await tx.get(progressRef);
    const current = currentSnap.exists ? currentSnap.data() : null;
    const currentId = typeof current?.['lastDocumentId'] === 'string'
      ? current['lastDocumentId'] : '';
    // An overlapping invocation may already have advanced this migration.
    if (current?.['complete'] === true || currentId !== lastDocumentId) return false;
    tx.set(progressRef, {
      lastDocumentId: nextDocumentId,
      complete: completesPage,
      updatedAt: now,
    }, { merge: true });
    return true;
  });

  return {
    scanned: snapshot.size,
    checkpointAdvanced: advanced,
    complete: advanced ? completesPage : false,
  };
}
