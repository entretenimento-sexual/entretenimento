import { describe, expect, it } from 'vitest';
import type { IAdminVideoProcessingStatus } from
  'src/app/core/services/moderation/admin-video-moderation.service';
import { assessVideoProcessingOperations } from './video-processing-triage.policy';

const schedulerNames = [
  'submitQueuedVideoProcessing', 'reconcileVideoProcessing',
  'cleanupCancelledVideoProcessing',
] as const;
function fixture(): IAdminVideoProcessingStatus {
  return {
    state: 'READY', checkedAt: 1_800_000_000_000,
    provider: {
      status: 'READY', reachable: true, projectId: null, location: 'us-central1',
      templateId: 'template', bucketName: null, checkedAt: 1_800_000_000_000,
      errorCode: null, errorMessage: null,
    },
    queue: {
      counts: { QUEUED: 0, SUBMITTING: 0, PROCESSING: 0, SUCCEEDED: 0,
        FAILED: 0, CANCEL_REQUESTED: 0, CANCELLED: 0 },
      activeTotal: 0, sampledActiveJobs: 0, oldestActiveAgeMs: null,
      staleSampledJobs: 0, sampleCapped: false,
      cancellation: { verification: 'UNVERIFIED', scheduleMinutes: 30,
        sampled: 0, due: 0, overdue24h: 0, missingOrInvalidDue: 0,
        samplePartial: false },
    },
    schedulers: schedulerNames.map(scheduler => ({
      scheduler, intervalMinutes: 5, health: 'OPERATIONAL',
      executionHealth: 'EXECUTED', jobsHealth: 'NO_ALERTS_OBSERVED',
      lastOutcome: 'OK', lastFinishedAt: 1_800_000_000_000, ageMs: 0,
      durationMs: 10, metrics: {}, evidenceConfidence: 'RECENT',
      historyCoverage: 'BEST_EFFORT', recentIncident: null, recentIncidentCount: 0,
    })),
  };
}

describe('video-processing-triage', () => {
  it('não confunde Transcoder acessível com scheduler em falha', () => {
    const x = fixture();
    x.schedulers[0].executionHealth = 'FAILED';
    expect(assessVideoProcessingOperations(x).priority).toBe('ACTION_REQUIRED');
    expect(assessVideoProcessingOperations(x).findings.join(' ')).toContain('Cloud Logging');
  });

  it('separa alerta de jobs, telemetria ausente e incidentes anteriores', () => {
    const x = fixture();
    x.schedulers[0].jobsHealth = 'ATTENTION';
    expect(assessVideoProcessingOperations(x).priority).toBe('ACTION_REQUIRED');
    x.schedulers[0].jobsHealth = 'UNVERIFIED';
    x.schedulers[0].evidenceConfidence = 'READ_UNAVAILABLE';
    expect(assessVideoProcessingOperations(x).priority).toBe('VERIFY');
    x.schedulers[0].jobsHealth = 'NO_ALERTS_OBSERVED';
    x.schedulers[0].evidenceConfidence = 'RECENT';
    x.schedulers[0].recentIncident = {
      startedAt: 100, finishedAt: 200, outcome: 'FAILED', phase: 'QUERY',
    };
    expect(assessVideoProcessingOperations(x).priority).toBe('VERIFY');
  });

  it('trata backlog atrasado e cancelamentos sem autorização de exclusão', () => {
    const x = fixture();
    x.queue.staleSampledJobs = 2;
    x.queue.cancellation!.overdue24h = 1;
    const diagnosis = assessVideoProcessingOperations(x);
    expect(diagnosis.priority).toBe('ACTION_REQUIRED');
    expect(diagnosis.findings.join(' ')).toContain('sem excluir arquivos');
  });

  it('não transforma amostra limitada e FAILED histórico em falha recente', () => {
    const x = fixture();
    x.queue.sampleCapped = true;
    x.queue.counts.FAILED = 1;
    expect(assessVideoProcessingOperations(x).priority).toBe('VERIFY');
  });

  it('não declara sucesso do processamento a partir de observações parciais', () => {
    const x = fixture();
    const result = assessVideoProcessingOperations(x);
    expect(result.priority).toBe('NO_ALERTS_OBSERVED');
    expect(result.findings.join(' ')).toContain('não certifica');
    x.provider.status = 'UNAVAILABLE';
    expect(assessVideoProcessingOperations(x).priority).toBe('ACTION_REQUIRED');
    x.provider.status = 'EMULATOR_SKIPPED';
    expect(assessVideoProcessingOperations(x).priority).toBe('EMULATOR');
  });
});
