// functions/src/community/run-community-discovery-exposure-retention.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY DISCOVERY EXPOSURE RETENTION
// -----------------------------------------------------------------------------
// Remove diariamente dias inteiros da telemetria agregada que saíram da janela
// de retenção. Fica isolado do purge destrutivo de Comunidades para que falha de
// observabilidade nunca bloqueie lifecycle, ownership ou exclusão de conteúdo.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityDiscoveryExposureRetentionSweep,
  COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_DAYS,
} from './community-discovery-exposure-retention.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const SCHEDULE = '15 5 * * *';
const TIME_ZONE = 'America/Sao_Paulo';
const SYSTEM_SOURCE = 'scheduled-community-discovery-exposure-retention';

function normalizeDayId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export const runCommunityDiscoveryExposureRetention = onSchedule(
  {
    schedule: SCHEDULE,
    timeZone: TIME_ZONE,
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    if (!isCommunityPreviewRuntimeAvailable()) {
      logger.info('community_discovery_exposure_retention_skipped_runtime', {
        source: SYSTEM_SOURCE,
      });
      return;
    }

    const startedAt = Date.now();
    const runtimeRef = db
      .collection('community_discovery_exposure_retention_runtime')
      .doc('daily');
    const runtimeSnapshot = await runtimeRef.get();
    const lastPrunedDay = normalizeDayId(
      runtimeSnapshot.exists
        ? runtimeSnapshot.data()?.['lastPrunedDay']
        : null
    );
    const sweepDays = buildCommunityDiscoveryExposureRetentionSweep({
      now: startedAt,
      lastPrunedDay,
    });

    for (const day of sweepDays) {
      await db.recursiveDelete(
        db.collection('community_discovery_exposure_daily').doc(day)
      );
    }

    const completedAt = Date.now();
    const nextLastPrunedDay = sweepDays.at(-1) ?? lastPrunedDay;

    await runtimeRef.set(
      {
        retentionDays: COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_DAYS,
        lastPrunedDay: nextLastPrunedDay,
        prunedDayCount: sweepDays.length,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        source: SYSTEM_SOURCE,
        updatedAt: completedAt,
      },
      { merge: true }
    );

    logger.info('community_discovery_exposure_retention_completed', {
      retentionDays: COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_DAYS,
      prunedDayCount: sweepDays.length,
      lastPrunedDay: nextLastPrunedDay,
      durationMs: Math.max(0, completedAt - startedAt),
      source: SYSTEM_SOURCE,
    });
  }
);
