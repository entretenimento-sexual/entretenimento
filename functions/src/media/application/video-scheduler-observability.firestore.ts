import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import {
  VIDEO_SCHEDULER_COLLECTION,
  type VideoSchedulerCycleRecord,
  type VideoSchedulerName,
  type VideoSchedulerMetrics,
  type VideoSchedulerOutcome,
  videoSchedulerRecord,
  mergeVideoSchedulerEvidence,
} from './video-scheduler-observability.policy';

export async function saveLastVideoSchedulerCycle(
  firestore: Firestore, record: VideoSchedulerCycleRecord
): Promise<boolean> {
  const ref = firestore.collection(VIDEO_SCHEDULER_COLLECTION).doc(record.scheduler);
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    // A late failing cycle enriches history without replacing the latest.
    const merged = mergeVideoSchedulerEvidence(
      snapshot.exists ? snapshot.data() : null, record
    );
    if (!merged) return false;
    transaction.set(ref, merged);
    return true;
  });
}

/** Telemetry cannot change submission, cancellation or cleanup semantics. */
export async function bestEffortSaveVideoSchedulerCycle(
  firestore: Firestore, record: VideoSchedulerCycleRecord
): Promise<void> {
  try {
    await saveLastVideoSchedulerCycle(firestore, record);
  } catch {
    logger.warn('[videoScheduler] Registro de evidência indisponível.', {
      event: 'VIDEO_MEDIA_SCHEDULER_EVIDENCE_UNAVAILABLE',
      scheduler: record.scheduler, cycleId: record.cycleId,
      outcome: record.outcome, finishedAt: record.finishedAt,
      evidenceReliability: 'WRITE_UNCONFIRMED',
    });
  }
}

export interface VideoSchedulerCycleContext {
  setPhase(phase: string): void;
}

export interface VideoSchedulerCycleResult {
  attention: boolean;
  metrics: VideoSchedulerMetrics;
}

export async function runObservedVideoScheduler(
  firestore: Firestore, scheduler: VideoSchedulerName,
  work: (context: VideoSchedulerCycleContext) => Promise<VideoSchedulerCycleResult>
): Promise<void> {
  const cycleId = randomUUID();
  const startedAt = Date.now();
  let phase = 'START';
  logger.info('[videoScheduler] Ciclo iniciado.', {
    event: 'VIDEO_MEDIA_SCHEDULER_STARTED', scheduler, cycleId,
  });
  try {
    const result = await work({ setPhase: value => { phase = value; } });
    const outcome: VideoSchedulerOutcome = result.attention ? 'ATTENTION' : 'OK';
    const record = videoSchedulerRecord(
      scheduler, cycleId, startedAt, Date.now(), outcome, phase, result.metrics
    );
    logger[result.attention ? 'warn' : 'info']('[videoScheduler] Ciclo encerrado.', {
      event: 'VIDEO_MEDIA_SCHEDULER_FINISHED', ...record,
    });
    await bestEffortSaveVideoSchedulerCycle(firestore, record);
  } catch (error) {
    const record = videoSchedulerRecord(
      scheduler, cycleId, startedAt, Date.now(), 'FAILED', phase, {}
    );
    logger.error('[videoScheduler] Falha no ciclo.', {
      event: 'VIDEO_MEDIA_SCHEDULER_FAILED',
      scheduler, cycleId, phase, durationMs: record.durationMs,
    });
    await bestEffortSaveVideoSchedulerCycle(firestore, record);
    throw error;
  }
}
