// functions/src/community/run-community-purge.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY PURGE
// -----------------------------------------------------------------------------
// Scheduler com modo operacional explícito:
// - off: inerte;
// - dry_run: avalia os mesmos probes/readiness sem excluir dados;
// - execute: habilita o executor destrutivo.
// Runtime de produção permanece bloqueado pela fronteira de Comunidades.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { executeCommunityPurge } from './community-purge.executor';
import { FirestoreCommunityPurgeAdapter } from './community-purge.firestore';
import { readCommunityPurgeInspection } from './community-purge-inspection.service';
import { resolveCommunityPurgeScheduleOptions } from './community-purge-schedule.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const SCHEDULE = '40 4 * * *';
const TIME_ZONE = 'America/Sao_Paulo';
const SYSTEM_SOURCE = 'scheduled-community-purge';

function normalizeCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 1_500) : null;
}

function errorMessage(error: unknown): string {
  return String(
    error instanceof Error ? error.message : error ?? 'unknown'
  ).slice(0, 300);
}

export const runCommunityPurge = onSchedule(
  {
    schedule: SCHEDULE,
    timeZone: TIME_ZONE,
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    if (!isCommunityPreviewRuntimeAvailable()) {
      logger.info('community_purge_run_skipped_runtime', {
        source: SYSTEM_SOURCE,
      });
      return;
    }

    const configRef = db.collection('platform_config').doc('community');
    const runtimeRef = db.collection('community_purge_runtime').doc('daily');
    const [configSnapshot, runtimeSnapshot] = await Promise.all([
      configRef.get(),
      runtimeRef.get(),
    ]);
    const config = configSnapshot.exists ? configSnapshot.data() ?? {} : {};
    const options = resolveCommunityPurgeScheduleOptions(config);

    if (options.mode === 'off') {
      logger.info('community_purge_run_skipped_off', {
        source: SYSTEM_SOURCE,
      });
      return;
    }

    const runtime = runtimeSnapshot.exists
      ? runtimeSnapshot.data() ?? {}
      : {};
    const adapter = new FirestoreCommunityPurgeAdapter();
    const startedAt = Date.now();
    let cursor = normalizeCursor(runtime['cursor']);
    let processed = 0;
    let completed = 0;
    let dryRunEligible = 0;
    let blocked = 0;
    let partial = 0;
    let failed = 0;
    let reachedEnd = false;

    while (processed < options.maxPerRun && !reachedEnd) {
      const remaining = options.maxPerRun - processed;
      const pageLimit = Math.min(remaining, 50);
      let pageQuery = db
        .collection('communities')
        .where('status', '==', 'scheduled_for_deletion')
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
        processed += 1;
        cursor = document.id;

        if (options.mode === 'dry_run') {
          try {
            const inspection = await readCommunityPurgeInspection(document.id, {
              now: startedAt,
              community: document.data(),
              config,
            });

            if (!inspection) {
              failed += 1;
              logger.error('community_purge_dry_run_candidate_missing', {
                communityId: document.id,
                mode: options.mode,
                source: SYSTEM_SOURCE,
              });
              continue;
            }

            if (inspection.eligible) {
              dryRunEligible += 1;
            } else {
              blocked += 1;
            }

            logger.info('community_purge_dry_run_candidate_inspected', {
              communityId: document.id,
              mode: options.mode,
              eligible: inspection.eligible,
              denialReason: inspection.denialReason,
              purgeEligibleAt: inspection.purgeEligibleAt,
              failedProbes: inspection.evidence.failedProbes,
              source: SYSTEM_SOURCE,
            });
          } catch (error: unknown) {
            failed += 1;
            logger.error('community_purge_dry_run_candidate_failed', {
              communityId: document.id,
              mode: options.mode,
              error: errorMessage(error),
              source: SYSTEM_SOURCE,
            });
          }

          continue;
        }

        const result = await executeCommunityPurge(adapter, {
          communityId: document.id,
          pageSize: options.pageSize,
          maxPagesPerStep: options.maxPagesPerStep,
        });

        if (result.status === 'completed') completed += 1;
        if (result.status === 'blocked') blocked += 1;
        if (result.status === 'partial') partial += 1;
        if (result.status === 'failed') failed += 1;

        const logPayload = {
          communityId: document.id,
          mode: options.mode,
          status: result.status,
          blocker: result.blocker ?? null,
          errorCode: result.errorCode ?? null,
          processed: result.processed,
          pages: result.pages,
          source: SYSTEM_SOURCE,
        };

        if (result.status === 'failed') {
          logger.error('community_purge_candidate_failed', logPayload);
        } else if (result.status === 'blocked' || result.status === 'partial') {
          logger.warn('community_purge_candidate_deferred', logPayload);
        } else {
          logger.info('community_purge_candidate_completed', logPayload);
        }
      }

      if (pageSnapshot.size < pageLimit) {
        cursor = null;
        reachedEnd = true;
      }
    }

    const completedAt = Date.now();

    await runtimeRef.set(
      {
        mode: options.mode,
        cursor,
        processed,
        completed,
        dryRunEligible,
        blocked,
        partial,
        failed,
        reachedEnd,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        source: SYSTEM_SOURCE,
        updatedAt: completedAt,
      },
      { merge: true }
    );

    logger.info('community_purge_run_completed', {
      mode: options.mode,
      processed,
      completed,
      dryRunEligible,
      blocked,
      partial,
      failed,
      reachedEnd,
      nextCursor: cursor,
      durationMs: Math.max(0, completedAt - startedAt),
      source: SYSTEM_SOURCE,
    });
  }
);
