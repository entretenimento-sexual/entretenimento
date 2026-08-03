import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildVideoProcessingDispatchMetrics,
  resolveVideoProcessingHealth,
  summarizeVideoProcessingFailureCodes,
  type VideoProcessingDispatchRecord,
} from './admin-video-processing-observability.policy';

function dispatch(
  patch: Partial<VideoProcessingDispatchRecord>
): VideoProcessingDispatchRecord {
  return {
    state: 'COMPLETED',
    mode: 'RECONCILE',
    createdAt: 1_000,
    updatedAt: 2_000,
    enqueuedAt: 1_100,
    completedAt: 2_000,
    taskAlreadyExisted: false,
    ...patch,
  };
}

describe('admin-video-processing-observability.policy', () => {
  it('calcula latência média, p50 e p95 dos despachos concluídos', () => {
    const metrics = buildVideoProcessingDispatchMetrics({
      records: [
        dispatch({ createdAt: 1_000, completedAt: 2_000 }),
        dispatch({ createdAt: 1_000, completedAt: 3_000 }),
        dispatch({ createdAt: 1_000, completedAt: 6_000 }),
      ],
      counts: { COMPLETED: 3 },
      checkedAt: 10_000,
    });

    assert.equal(metrics.latencySampleSize, 3);
    assert.equal(metrics.averageLatencyMs, 2_666);
    assert.equal(metrics.p50LatencyMs, 2_000);
    assert.equal(metrics.p95LatencyMs, 5_000);
  });

  it('mede backlog pendente pela criação do despacho', () => {
    const metrics = buildVideoProcessingDispatchMetrics({
      records: [
        dispatch({
          state: 'ENQUEUED',
          createdAt: 1_000,
          updatedAt: 8_000,
          completedAt: null,
        }),
        dispatch({
          state: 'ENQUEUEING',
          createdAt: 4_000,
          updatedAt: 4_000,
          completedAt: null,
        }),
      ],
      counts: { ENQUEUING: 1, ENQUEUED: 1 },
      checkedAt: 11_000,
    });

    assert.equal(metrics.pendingTotal, 2);
    assert.equal(metrics.oldestPendingAgeMs, 10_000);
  });

  it('contabiliza falhas, conclusões e duplicatas na janela recente', () => {
    const metrics = buildVideoProcessingDispatchMetrics({
      records: [
        dispatch({
          state: 'FAILED',
          updatedAt: 90_000,
          completedAt: null,
        }),
        dispatch({
          state: 'COMPLETED',
          completedAt: 95_000,
          taskAlreadyExisted: true,
        }),
        dispatch({
          state: 'COMPLETED',
          completedAt: 10_000,
        }),
      ],
      counts: { FAILED: 1, COMPLETED: 2 },
      checkedAt: 100_000,
      recentWindowMs: 20_000,
    });

    assert.equal(metrics.recentTotal, 2);
    assert.equal(metrics.completedRecent, 1);
    assert.equal(metrics.failedRecent, 1);
    assert.equal(metrics.duplicateRecent, 1);
  });

  it('agrupa códigos de falha e mantém o mais recente', () => {
    const summary = summarizeVideoProcessingFailureCodes([
      { errorCode: 'HTTP_500', failedAt: 10_000 },
      { errorCode: 'HTTP_500', failedAt: 20_000 },
      { errorCode: null, failedAt: 30_000 },
    ]);

    assert.deepEqual(summary, [
      { code: 'HTTP_500', count: 2, lastSeenAt: 20_000 },
      {
        code: 'UNCLASSIFIED_PROCESSING_FAILURE',
        count: 1,
        lastSeenAt: 30_000,
      },
    ]);
  });

  it('classifica indisponibilidade do provedor como crítica', () => {
    const dispatchMetrics = buildVideoProcessingDispatchMetrics({
      records: [],
      counts: {},
      checkedAt: 100_000,
    });
    const health = resolveVideoProcessingHealth({
      providerStatus: 'UNAVAILABLE',
      staleSampledJobs: 0,
      activeSampleCapped: false,
      dispatch: dispatchMetrics,
      recentDeadLetters: 0,
    });

    assert.equal(health.state, 'DEGRADED');
    assert.equal(health.alerts[0]?.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(health.alerts[0]?.severity, 'CRITICAL');
  });

  it('classifica backlog prolongado e DLQ recente', () => {
    const dispatchMetrics = buildVideoProcessingDispatchMetrics({
      records: [
        dispatch({
          state: 'ENQUEUED',
          createdAt: 1_000,
          updatedAt: 1_000,
          completedAt: null,
        }),
      ],
      counts: { ENQUEUED: 1 },
      checkedAt: 20 * 60_000,
    });
    const health = resolveVideoProcessingHealth({
      providerStatus: 'READY',
      staleSampledJobs: 2,
      activeSampleCapped: true,
      dispatch: dispatchMetrics,
      recentDeadLetters: 3,
    });

    assert.equal(health.state, 'DEGRADED');
    assert.deepEqual(
      health.alerts.map((alert) => alert.code),
      [
        'DISPATCH_BACKLOG',
        'STALE_JOBS',
        'RECENT_DEAD_LETTERS',
        'ACTIVE_SAMPLE_CAPPED',
      ]
    );
  });

  it('preserva estado Emulator sem ocultar alertas', () => {
    const dispatchMetrics = buildVideoProcessingDispatchMetrics({
      records: [],
      counts: { FAILED: 1 },
      checkedAt: 100_000,
    });
    const health = resolveVideoProcessingHealth({
      providerStatus: 'EMULATOR_SKIPPED',
      staleSampledJobs: 0,
      activeSampleCapped: false,
      dispatch: dispatchMetrics,
      recentDeadLetters: 0,
    });

    assert.equal(health.state, 'EMULATOR');
    assert.equal(health.alerts[0]?.code, 'DISPATCH_FAILURES');
  });
});
