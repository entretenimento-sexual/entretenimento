import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PHOTO_RANKING_BACKFILL_DEFAULT_PAGE_SIZE,
  PHOTO_RANKING_BACKFILL_MAX_PAGE_SIZE,
  PHOTO_RANKING_BACKFILL_MAX_CONSECUTIVE_FAILURES,
  PHOTO_RANKING_BACKFILL_MIN_PAGE_SIZE,
  buildInitialPhotoRankingBackfillState,
  isPhotoRankingBackfillLeaseAvailable,
  nextPhotoRankingBackfillFailureStatus,
  normalizePhotoRankingBackfillAction,
  normalizePhotoRankingBackfillCursorPath,
  normalizePhotoRankingBackfillOperationId,
  normalizePhotoRankingBackfillPageSize,
  normalizePhotoRankingBackfillState,
} from './photo-ranking-backfill.policy';

describe('photo-ranking-backfill.policy', () => {
  it('limita o tamanho das páginas', () => {
    assert.equal(
      normalizePhotoRankingBackfillPageSize(undefined),
      PHOTO_RANKING_BACKFILL_DEFAULT_PAGE_SIZE
    );
    assert.equal(
      normalizePhotoRankingBackfillPageSize(1),
      PHOTO_RANKING_BACKFILL_MIN_PAGE_SIZE
    );
    assert.equal(
      normalizePhotoRankingBackfillPageSize(999),
      PHOTO_RANKING_BACKFILL_MAX_PAGE_SIZE
    );
  });

  it('aceita somente cursores de fotos públicas', () => {
    assert.equal(
      normalizePhotoRankingBackfillCursorPath(
        'public_profiles/user-1/public_photos/photo_2'
      ),
      'public_profiles/user-1/public_photos/photo_2'
    );
    assert.equal(
      normalizePhotoRankingBackfillCursorPath(
        'users/user-1/photos/photo-2'
      ),
      null
    );
    assert.equal(
      normalizePhotoRankingBackfillCursorPath('../public_photos/photo-2'),
      null
    );
  });

  it('normaliza ações e operações administrativas', () => {
    assert.equal(normalizePhotoRankingBackfillAction('run_page'), 'RUN_PAGE');
    assert.equal(normalizePhotoRankingBackfillAction('delete'), null);
    assert.equal(
      normalizePhotoRankingBackfillOperationId('operation_123'),
      'operation_123'
    );
    assert.equal(normalizePhotoRankingBackfillOperationId('curto'), '');
  });

  it('inicializa execução retomável com contadores zerados', () => {
    const state = buildInitialPhotoRankingBackfillState({
      now: 1_800_000_000_000,
      pageSize: 150,
    });

    assert.equal(state.status, 'RUNNING');
    assert.equal(state.pageSize, 150);
    assert.equal(state.cursorPath, null);
    assert.equal(state.processedCount, 0);
    assert.equal(state.generation, 1);
    assert.equal(state.startedAt, 1_800_000_000_000);
  });

  it('recupera estado legado sem confiar em valores inválidos', () => {
    const state = normalizePhotoRankingBackfillState(
      {
        status: 'INVALID',
        pageSize: 999,
        cursorPath: 'users/u/photos/p',
        processedCount: -10,
        generation: 0,
      },
      1_800_000_000_000
    );

    assert.equal(state.status, 'RUNNING');
    assert.equal(state.pageSize, PHOTO_RANKING_BACKFILL_MAX_PAGE_SIZE);
    assert.equal(state.cursorPath, null);
    assert.equal(state.processedCount, 0);
    assert.equal(state.generation, 1);
  });

  it('impede concorrência até o lease expirar', () => {
    const state = buildInitialPhotoRankingBackfillState({ now: 10_000 });
    state.leaseOwner = 'run-a';
    state.leaseExpiresAt = 20_000;

    assert.equal(
      isPhotoRankingBackfillLeaseAvailable({
        state,
        now: 15_000,
        runId: 'run-b',
      }),
      false
    );
    assert.equal(
      isPhotoRankingBackfillLeaseAvailable({
        state,
        now: 20_000,
        runId: 'run-b',
      }),
      true
    );
  });

  it('interrompe a retomada automática após falhas consecutivas', () => {
    assert.equal(nextPhotoRankingBackfillFailureStatus(1), 'RUNNING');
    assert.equal(
      nextPhotoRankingBackfillFailureStatus(
        PHOTO_RANKING_BACKFILL_MAX_CONSECUTIVE_FAILURES
      ),
      'FAILED'
    );
  });
});
