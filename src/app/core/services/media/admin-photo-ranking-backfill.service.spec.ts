import {
  normalizeAdminPhotoRankingBackfillState,
  normalizeAdminPhotoRankingBackfillStatusResponse,
} from './admin-photo-ranking-backfill.service';

describe('AdminPhotoRankingBackfillService normalização', () => {
  it('normaliza estado inválido sem expor campos internos', () => {
    const state = normalizeAdminPhotoRankingBackfillState({
      version: '4',
      status: 'running',
      pageSize: 999,
      processedCount: '120',
      updatedCount: -1,
      skippedCount: 30.9,
      pagesCount: 1,
      consecutiveFailures: '2',
      cursorPath: 'public_profiles/user/public_photos/photo',
      leaseOwner: 'segredo-interno',
      lastAdminOperationId: 'operacao-interna',
      lastAdminBy: 'admin-interno',
      generation: 0,
    });

    expect(state).toEqual({
      version: 4,
      status: 'RUNNING',
      pageSize: 180,
      processedCount: 120,
      updatedCount: 0,
      skippedCount: 30,
      pagesCount: 1,
      consecutiveFailures: 2,
      startedAt: null,
      updatedAt: 0,
      completedAt: null,
      lastBatchAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastAdminAction: null,
      generation: 1,
    });

    expect('cursorPath' in state).toBeFalse();
    expect('leaseOwner' in state).toBeFalse();
    expect('lastAdminOperationId' in state).toBeFalse();
    expect('lastAdminBy' in state).toBeFalse();
  });

  it('preserva apenas status, métricas e erro sanitizado', () => {
    const response = normalizeAdminPhotoRankingBackfillStatusResponse({
      state: {
        version: 4,
        status: 'FAILED',
        pageSize: 120,
        processedCount: 500,
        updatedCount: 200,
        skippedCount: 300,
        pagesCount: 5,
        consecutiveFailures: 5,
        startedAt: 1000,
        updatedAt: 2000,
        completedAt: null,
        lastBatchAt: 1900,
        lastErrorCode: 'BACKFILL_BATCH_FAILED',
        lastErrorMessage: 'Falha sanitizada.',
        lastAdminAction: 'START_OR_RESUME',
        generation: 2,
      },
      leaseActive: true,
      checkedAt: 2100,
    });

    expect(response.leaseActive).toBeTrue();
    expect(response.checkedAt).toBe(2100);
    expect(response.state.status).toBe('FAILED');
    expect(response.state.processedCount).toBe(500);
    expect(response.state.lastErrorCode).toBe('BACKFILL_BATCH_FAILED');
    expect(response.state.lastErrorMessage).toBe('Falha sanitizada.');
    expect(response.state.generation).toBe(2);
  });

  it('aplica valores seguros a respostas ausentes', () => {
    const response = normalizeAdminPhotoRankingBackfillStatusResponse(null);

    expect(response.leaseActive).toBeFalse();
    expect(response.checkedAt).toBe(0);
    expect(response.state.status).toBe('IDLE');
    expect(response.state.pageSize).toBe(120);
    expect(response.state.generation).toBe(1);
  });
});
