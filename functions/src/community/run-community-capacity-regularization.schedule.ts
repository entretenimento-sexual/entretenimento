// functions/src/community/run-community-capacity-regularization.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY CAPACITY REGULARIZATION
// -----------------------------------------------------------------------------
// Avança grace periods vencidos e faz uma varredura paginada de owners para
// capturar expiração temporal de entitlement mesmo quando nenhum webhook é
// emitido exatamente no instante do vencimento.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  reconcileCommunityCapacityRegularizationForOwner,
} from './community-capacity-regularization.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const PAGE_SIZE = 100;

function cleanUid(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(normalized) ? normalized : null;
}

function cleanCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 1_500) : null;
}

export const runCommunityCapacityRegularization = onSchedule(
  {
    schedule: '40 3 * * *',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    if (!isCommunityPreviewRuntimeAvailable()) {
      logger.info('community_capacity_regularization_skipped_runtime_guard');
      return;
    }

    const now = Date.now();
    const runtimeRef = db
      .collection('community_capacity_regularization_runtime')
      .doc('daily');
    const runtimeSnapshot = await runtimeRef.get();
    const runtime = runtimeSnapshot.exists ? runtimeSnapshot.data() ?? {} : {};
    const dueSnapshot = await db
      .collection('communities')
      .where('capacityRegularization.nextEvaluationAt', '<=', now)
      .limit(PAGE_SIZE)
      .get();

    const owners = new Set<string>();
    for (const document of dueSnapshot.docs) {
      const ownerUid = cleanUid(document.data()['ownerUid']);
      if (ownerUid) owners.add(ownerUid);
    }

    let cursor = cleanCursor(runtime['cursor']);
    let query = db
      .collection('communities')
      .where('source.type', '==', 'community')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);

    if (cursor) query = query.startAfter(cursor);

    const pageSnapshot = await query.get();

    if (pageSnapshot.empty) {
      cursor = null;
    } else {
      for (const document of pageSnapshot.docs) {
        const data = document.data();
        const status = String(data['status'] ?? '').trim();
        if (['active', 'paused', 'dormant'].includes(status)) {
          const ownerUid = cleanUid(data['ownerUid']);
          if (ownerUid) owners.add(ownerUid);
        }
      }

      cursor = pageSnapshot.size < PAGE_SIZE
        ? null
        : pageSnapshot.docs[pageSnapshot.docs.length - 1]?.id ?? null;
    }

    let reconciledOwners = 0;
    for (const ownerUid of owners) {
      await reconcileCommunityCapacityRegularizationForOwner(ownerUid, now);
      reconciledOwners += 1;
    }

    await runtimeRef.set(
      {
        cursor,
        dueCommunities: dueSnapshot.size,
        scannedCommunities: pageSnapshot.size,
        reconciledOwners,
        lastRunAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    logger.info('community_capacity_regularization_run_completed', {
      dueCommunities: dueSnapshot.size,
      scannedCommunities: pageSnapshot.size,
      reconciledOwners,
      nextCursor: cursor,
    });
  }
);
