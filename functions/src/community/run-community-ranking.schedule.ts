// functions/src/community/run-community-ranking.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY DISCOVERY RANKING
// -----------------------------------------------------------------------------
// Reavalia periodicamente o score para que o componente de frescor decaia mesmo
// sem novas escritas. O ciclo percorre a própria projeção de descoberta: assim,
// a readiness só fica positiva quando todo documento consultável possui fonte
// canônica compatível e score da versão atual. Mudança de versão reinicia o
// cursor para impedir readiness com uma coleção parcialmente migrada.
// `rankScore` legado permanece apenas como fallback de rollout/rollback.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { COMMUNITY_DISCOVERY_SCORE_VERSION } from './community-ranking.policy';
import {
  buildCommunityRankingProjectionPatch,
  isCommunityRankingProjectionCurrent,
  isCommunityRankingRuntimeCurrent,
  isCommunityRankingSupportedDocument,
  resolveCommunityRankingMaxPerRun,
} from './community-ranking-sync.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const PAGE_SIZE = 100;

function normalizeCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 1_500) : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
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
    const runtimeCurrent = isCommunityRankingRuntimeCurrent(runtime);
    let cursor = runtimeCurrent ? normalizeCursor(runtime['cursor']) : null;
    const continuingCycle = runtimeCurrent && cursor !== null;
    const cycleStartedAt = continuingCycle
      ? normalizeTimestamp(runtime['cycleStartedAt']) ?? now
      : now;
    let cycleProcessed = continuingCycle
      ? normalizeCount(runtime['cycleProcessed'])
      : 0;
    let cycleUpdated = continuingCycle
      ? normalizeCount(runtime['cycleUpdated'])
      : 0;
    let cycleUnchanged = continuingCycle
      ? normalizeCount(runtime['cycleUnchanged'])
      : 0;
    let cycleOrphanProjections = continuingCycle
      ? normalizeCount(runtime['cycleOrphanProjections'])
      : 0;
    let cycleUnsupported = continuingCycle
      ? normalizeCount(runtime['cycleUnsupported'])
      : 0;
    let processedThisRun = 0;
    let reachedEnd = false;
    let readinessInvalidated = false;

    while (processedThisRun < maxPerRun && !reachedEnd) {
      const remaining = maxPerRun - processedThisRun;
      const pageLimit = Math.min(PAGE_SIZE, remaining);
      let pageQuery = db
        .collection('community_discovery_index')
        .orderBy(FieldPath.documentId())
        .limit(pageLimit);

      if (cursor) pageQuery = pageQuery.startAfter(cursor);

      const pageSnapshot = await pageQuery.get();

      if (pageSnapshot.empty) {
        cursor = null;
        reachedEnd = true;
        break;
      }

      const communityRefs = pageSnapshot.docs.map((document) =>
        db.collection('communities').doc(document.id)
      );
      const communitySnapshots = await db.getAll(...communityRefs);
      const writeBatch = db.batch();
      let pendingWrites = 0;

      for (let index = 0; index < pageSnapshot.docs.length; index += 1) {
        const discoveryDocument = pageSnapshot.docs[index];
        const communitySnapshot = communitySnapshots[index];
        processedThisRun += 1;
        cycleProcessed += 1;
        cursor = discoveryDocument.id;

        if (!communitySnapshot.exists) {
          cycleOrphanProjections += 1;
          readinessInvalidated = true;
          continue;
        }

        const community = communitySnapshot.data() ?? {};
        if (!isCommunityRankingSupportedDocument(community)) {
          cycleUnsupported += 1;
          readinessInvalidated = true;
          continue;
        }

        const discovery = discoveryDocument.data();
        const expected = buildCommunityRankingProjectionPatch(
          community,
          discovery,
          now
        );

        if (isCommunityRankingProjectionCurrent(discovery, expected)) {
          cycleUnchanged += 1;
          continue;
        }

        writeBatch.set(discoveryDocument.ref, expected, { merge: true });
        pendingWrites += 1;
        cycleUpdated += 1;
      }

      if (pendingWrites > 0) {
        await writeBatch.commit();
      }

      if (pageSnapshot.size < pageLimit) {
        cursor = null;
        reachedEnd = true;
      }
    }

    const cycleReady = reachedEnd
      && cycleOrphanProjections === 0
      && cycleUnsupported === 0;
    const previouslyReady = runtime['ready'] === true
      && Number(runtime['completedScoreVersion'])
        === COMMUNITY_DISCOVERY_SCORE_VERSION;
    const ready = reachedEnd
      ? cycleReady
      : readinessInvalidated
        ? false
        : previouslyReady;
    const runtimePatch: Record<string, unknown> = {
      cursor: reachedEnd ? null : cursor,
      ready,
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      processedThisRun,
      reachedEnd,
      scoreEvaluationAt: now,
      updatedAt: now,
    };

    if (reachedEnd) {
      runtimePatch['cycleStartedAt'] = null;
      runtimePatch['cycleProcessed'] = 0;
      runtimePatch['cycleUpdated'] = 0;
      runtimePatch['cycleUnchanged'] = 0;
      runtimePatch['cycleOrphanProjections'] = 0;
      runtimePatch['cycleUnsupported'] = 0;
      runtimePatch['lastCycleCompletedAt'] = now;
      runtimePatch['lastCycleReady'] = cycleReady;
      runtimePatch['lastCycleStats'] = {
        processed: cycleProcessed,
        updated: cycleUpdated,
        unchanged: cycleUnchanged,
        orphanProjections: cycleOrphanProjections,
        unsupported: cycleUnsupported,
      };
      runtimePatch['completedScoreVersion'] = cycleReady
        ? COMMUNITY_DISCOVERY_SCORE_VERSION
        : null;

      if (cycleReady) {
        runtimePatch['lastCompletedAt'] = now;
      }
    } else {
      runtimePatch['cycleStartedAt'] = cycleStartedAt;
      runtimePatch['cycleProcessed'] = cycleProcessed;
      runtimePatch['cycleUpdated'] = cycleUpdated;
      runtimePatch['cycleUnchanged'] = cycleUnchanged;
      runtimePatch['cycleOrphanProjections'] = cycleOrphanProjections;
      runtimePatch['cycleUnsupported'] = cycleUnsupported;
    }

    await runtimeRef.set(runtimePatch, { merge: true });

    logger.info('community_ranking_run_completed', {
      processedThisRun,
      cycleProcessed,
      cycleUpdated,
      cycleUnchanged,
      cycleOrphanProjections,
      cycleUnsupported,
      reachedEnd,
      ready,
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      restartedForScoreVersion: runtimeSnapshot.exists && !runtimeCurrent,
      nextCursor: reachedEnd ? null : cursor,
    });
  }
);
