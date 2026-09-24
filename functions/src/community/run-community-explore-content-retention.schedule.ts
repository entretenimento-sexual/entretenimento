// functions/src/community/run-community-explore-content-retention.schedule.ts
// -----------------------------------------------------------------------------
// COMMUNITY EXPLORE CONTENT RETENTION
// -----------------------------------------------------------------------------
// O índice global é somente uma superfície de distribuição efêmera. Conteúdo
// expirado é removido em lotes limitados para impedir crescimento indefinido.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';

const SCHEDULE = '35 5 * * *';
const TIME_ZONE = 'America/Sao_Paulo';
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 4;

export const runCommunityExploreContentRetention = onSchedule(
  {
    schedule: SCHEDULE,
    timeZone: TIME_ZONE,
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    const startedAt = Date.now();
    let deleted = 0;
    let batches = 0;

    while (batches < MAX_BATCHES_PER_RUN) {
      const snapshot = await db
        .collection('community_explore_content_index')
        .where('expiresAt', '<=', Date.now())
        .limit(BATCH_SIZE)
        .get();

      if (snapshot.empty) break;

      const batch = db.batch();
      for (const document of snapshot.docs) {
        batch.delete(document.ref);
      }
      await batch.commit();

      deleted += snapshot.size;
      batches += 1;

      if (snapshot.size < BATCH_SIZE) break;
    }

    logger.info('community_explore_content_retention_completed', {
      deleted,
      batches,
      durationMs: Date.now() - startedAt,
      capped: batches >= MAX_BATCHES_PER_RUN,
    });
  }
);
