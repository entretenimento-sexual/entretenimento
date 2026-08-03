import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveVideoProcessingDispatch,
} from './video-processing-dispatch.policy';
import type { VideoProcessingJob } from './video-processing-job';

function job(
  patch: Partial<VideoProcessingJob>
): Partial<VideoProcessingJob> {
  return {
    ownerUid: 'owner-1',
    videoId: 'video-1',
    processingVersion: 'version-1',
    state: 'QUEUED',
    nextAttemptAt: 10_000,
    leaseUntil: null,
    cancelRequestedAt: null,
    createdAt: 5_000,
    updatedAt: 9_000,
    ...patch,
  };
}

describe('resolveVideoProcessingDispatch', () => {
  it('agenda submissão no nextAttemptAt do job', () => {
    const dispatch = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({ state: 'QUEUED', nextAttemptAt: 20_000 }),
      10_000
    );

    assert.equal(dispatch?.mode, 'SUBMIT');
    assert.equal(dispatch?.dueAt, 20_000);
    assert.equal(dispatch?.scheduleAt, 20_000);
  });

  it('agenda recuperação somente no vencimento do lease', () => {
    const dispatch = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({ state: 'SUBMITTING', leaseUntil: 50_000 }),
      10_000
    );

    assert.equal(dispatch?.mode, 'RECOVER_SUBMISSION');
    assert.equal(dispatch?.dueAt, 50_000);
  });

  it('agenda reconciliação um minuto após a última atualização', () => {
    const dispatch = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({ state: 'PROCESSING', updatedAt: 40_000 }),
      50_000
    );

    assert.equal(dispatch?.mode, 'RECONCILE');
    assert.equal(dispatch?.dueAt, 100_000);
  });

  it('agenda cancelamento imediatamente sem perder identidade estável', () => {
    const first = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: 70_000,
        updatedAt: 80_000,
      }),
      90_000
    );
    const duplicate = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: 70_000,
        updatedAt: 80_000,
      }),
      95_000
    );

    assert.equal(first?.mode, 'CANCEL');
    assert.equal(first?.scheduleAt, 90_000);
    assert.equal(first?.taskId, duplicate?.taskId);
  });

  it('mantém a identidade idempotente para entregas duplicadas', () => {
    const first = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({ state: 'QUEUED', nextAttemptAt: 20_000 }),
      10_000
    );
    const duplicate = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({ state: 'QUEUED', nextAttemptAt: 20_000 }),
      15_000
    );

    assert.equal(first?.dispatchId, duplicate?.dispatchId);
    assert.match(first?.taskId ?? '', /^video-processing-[a-f0-9]{64}$/);
  });

  it('gera uma nova identidade quando o retry muda o vencimento', () => {
    const first = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({ state: 'QUEUED', nextAttemptAt: 20_000 }),
      10_000
    );
    const retry = resolveVideoProcessingDispatch(
      'owner-1_video-1',
      job({ state: 'QUEUED', nextAttemptAt: 40_000 }),
      10_000
    );

    assert.notEqual(first?.taskId, retry?.taskId);
  });

  it('não agenda estados terminais', () => {
    assert.equal(
      resolveVideoProcessingDispatch(
        'owner-1_video-1',
        job({ state: 'SUCCEEDED' }),
        10_000
      ),
      null
    );
    assert.equal(
      resolveVideoProcessingDispatch(
        'owner-1_video-1',
        job({ state: 'FAILED' }),
        10_000
      ),
      null
    );
    assert.equal(
      resolveVideoProcessingDispatch(
        'owner-1_video-1',
        job({ state: 'CANCELLED' }),
        10_000
      ),
      null
    );
  });

  it('rejeita identificadores ou versões inválidos', () => {
    assert.equal(
      resolveVideoProcessingDispatch(
        'owner/video',
        job({ state: 'QUEUED' }),
        10_000
      ),
      null
    );
    assert.equal(
      resolveVideoProcessingDispatch(
        'owner-1_video-1',
        job({ processingVersion: 'versão inválida' }),
        10_000
      ),
      null
    );
  });
});
