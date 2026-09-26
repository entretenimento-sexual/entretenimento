// functions/src/account_lifecycle/reconcileModerationSuspensions.ts
// -----------------------------------------------------------------------------
// RECONCILE MODERATION SUSPENSIONS
// -----------------------------------------------------------------------------
// Encerra apenas suspensões temporárias da moderação cujo suspensionEndsAt
// venceu. Suspensões sem prazo permanecem intactas. Billing não é reativado.
// -----------------------------------------------------------------------------

import {
  FieldPath,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db } from '../firebaseApp';
import { ACCOUNT_LIFECYCLE_REGION } from './_shared';
import {
  restoreModerationSuspension,
} from './account-moderation-unsuspension.service';

const PAGE_SIZE = 100;
const CONCURRENCY = 10;

async function reconcileChunk(
  documents: QueryDocumentSnapshot[],
  now: number
): Promise<{ restored: number; skipped: number; failed: number }> {
  let restored = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < documents.length; index += CONCURRENCY) {
    const chunk = documents.slice(index, index + CONCURRENCY);

    const results = await Promise.all(
      chunk.map(async (document) => {
        try {
          const result = await restoreModerationSuspension({
            targetUid: document.id,
            actorUid: 'system',
            source: 'system',
            requireExpired: true,
            now,
          });

          return result.changed ? 'restored' as const : 'skipped' as const;
        } catch (error) {
          console.error('[account-lifecycle] suspension expiry failed', {
            uid: document.id,
            error,
          });
          return 'failed' as const;
        }
      })
    );

    for (const result of results) {
      if (result === 'restored') restored += 1;
      else if (result === 'skipped') skipped += 1;
      else failed += 1;
    }
  }

  return { restored, skipped, failed };
}

export const reconcileModerationSuspensions = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Sao_Paulo',
    region: ACCOUNT_LIFECYCLE_REGION,
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    const now = Date.now();
    let cursor: QueryDocumentSnapshot | null = null;
    let scanned = 0;
    let restored = 0;
    let skipped = 0;
    let failed = 0;

    while (true) {
      let query = db
        .collection('users')
        .where('accountStatus', '==', 'moderation_suspended')
        .where('suspensionEndsAt', '<=', now)
        .orderBy('suspensionEndsAt', 'asc')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(PAGE_SIZE);

      if (cursor) {
        query = query.startAfter(cursor);
      }

      const page = await query.get();
      if (page.empty) break;

      const result = await reconcileChunk(page.docs, now);
      scanned += page.size;
      restored += result.restored;
      skipped += result.skipped;
      failed += result.failed;
      cursor = page.docs[page.docs.length - 1] ?? null;

      if (page.size < PAGE_SIZE) break;
    }

    console.log('[account-lifecycle] moderation suspension reconciliation', {
      scanned,
      restored,
      skipped,
      failed,
    });
  }
);
