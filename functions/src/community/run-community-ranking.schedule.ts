// functions/src/community/run-community-ranking.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY DISCOVERY RANKING
// -----------------------------------------------------------------------------
// Reavalia periodicamente o score para que o componente de frescor decaia mesmo
// sem novas escritas. Também funciona como backfill idempotente das projeções.
// `rankScore` legado continua intacto até a migração explícita da descoberta.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityRankingProjectionPatch,
  isCommunityRankingProjectionCurrent,
  isCommunityRankingSupportedDocument,
  resolveCommunityRankingMaxPerRun,
} from './community-ranking-sync.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const PAGE_SIZE = 100;

function normalizeCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 1_500) : null;
}

export const runCommunityRanking = onSchedule(
  {
    schedule: '25 3 * * *',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    if (!isCommunityPreviewRuntimeAvailable()) {
      logger.info('community_ranking_skipped_runtime_guard');
      return;
    }

    const now = Date.now();
    const configRef = db.collection('platform_config').doc('community');
    const runtimeRef = db.collection('community_ranking_runtime').doc('daily');
    const [configSnapshot, runtimeSnapshot] = await Promise.all([
      configRef.get(),
      runtimeRef.get(),
    ]);
    const config = configSnapshot.exists ? configSnapshot.data() ?? {} : {};
    const runtime = runtimeSnapshot.exists ? runtimeSnapshot.data() ?? {} : {};
    const maxPerRun = resolveCommunityRankingMaxPerRun(config);
    let cursor = normalizeCursor(runtime['cursor']);
    let processed = 0;
    let updated = 0;
    let unchanged = 0;
    let unsupported = 0;
    let missingProjection = 0;
    let reachedEnd = false;

    while (processed < maxPerRun && !reachedEnd) {
      const remaining = maxPerRun - processed;
      const pageLimit = Math.min(PAGE_SIZE, remaining);
      let pageQuery = db
        .collection('communities')
        .orderBy(FieldPath.documentId())
        .limit(pageLimit);

      if (cursor) pageQuery = pageQuery.startAfter(cursor);

      const pageSnapshot = await pageQuery.get();

      if (pageSnapshot.empty) {
        cursor = null;
        reachedEnd = true;
        break;
      }

      for (const document of pageSnapshot.docs) {
        const community = document.data();
        processed += 1;
        cursor = document.id;

        if (!isCommunityRankingSupportedDocument(community)) {
          unsupported += 1;
          continue;
        }

        const discoveryRef = db
          .collection('community_discovery_index')
          .doc(document.id);
        const discoverySnapshot = await discoveryRef.get();

        if (!discoverySnapshot.exists) {
          missingProjection += 1;
          continue;
        }

        const discovery = discoverySnapshot.data() ?? {};
        const expected = buildCommunityRankingProjectionPatch(
          community,
          discovery,
          now
        );

        if (isCommunityRankingProjectionCurrent(discovery, expected)) {
          unchanged += 1;
          continue;
        }

        await discoveryRef.set(expected, { merge: true });
        updated += 1;
      }

      if (pageSnapshot.size < pageLimit) {
        cursor = null;
        reachedEnd = true;
      }
    }

    await runtimeRef.set(
      {
        cursor,
        processed,
        updated,
        unchanged,
        unsupported,
        missingProjection,
        reachedEnd,
        scoreEvaluationAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    logger.info('community_ranking_run_completed', {
      processed,
      updated,
      unchanged,
      unsupported,
      missingProjection,
      reachedEnd,
      nextCursor: cursor,
    });
  }
);
