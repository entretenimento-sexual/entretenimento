import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEDIA_CLEANUP_MAX_ATTEMPTS,
  MEDIA_CLEANUP_RETRY_BASE_MS,
  MEDIA_CLEANUP_RETRY_MAX_MS,
} from './media-cleanup-retry.policy';
import {
  nextVideoCleanupRetry,
  resolveVideoCleanupJobScheduling,
} from './video-cleanup-job.policy';

const NOW = 1_800_000_000_000;

describe('video cleanup scheduling', () => {
  it('aplica backoff de 15min com teto de 24h', () => {
    const first = nextVideoCleanupRetry(0, NOW);
    assert.equal(first.state, 'retryable');
    assert.equal(first.attempts, 1);
    assert.equal(first.nextAttemptAt, NOW + MEDIA_CLEANUP_RETRY_BASE_MS);

    const later = nextVideoCleanupRetry(6, NOW);
    assert.equal(later.state, 'retryable');
    assert.ok((later.nextAttemptAt ?? 0) <= NOW + MEDIA_CLEANUP_RETRY_MAX_MS);
    assert.ok((later.nextAttemptAt ?? 0) > first.nextAttemptAt!);
  });

  it('não apaga automaticamente o registro de dead letter', () => {
    const outcome = nextVideoCleanupRetry(MEDIA_CLEANUP_MAX_ATTEMPTS - 1, NOW);
    assert.equal(outcome.state, 'dead_letter');
    assert.equal(outcome.attempts, MEDIA_CLEANUP_MAX_ATTEMPTS);
    assert.equal(outcome.nextAttemptAt, null);
    assert.equal(outcome.deadLetterExpiresAt, null);
  });

  it('preserva agendamento já válido', () => {
    assert.deepEqual(resolveVideoCleanupJobScheduling({
      attempts: 2,
      state: 'retryable',
      nextAttemptAt: NOW + 30_000,
    }, NOW), {
      state: 'retryable',
      nextAttemptAt: NOW + 30_000,
      requiresMigration: false,
    });
  });

  it('detecta job legado sem nextAttemptAt para migração', () => {
    assert.deepEqual(resolveVideoCleanupJobScheduling({ attempts: 1 }, NOW), {
      state: 'retryable',
      nextAttemptAt: NOW,
      requiresMigration: true,
    });
  });

  it('normaliza agendamento inválido sem adiar limpeza', () => {
    const result = resolveVideoCleanupJobScheduling({
      attempts: 'bad',
      state: 'retryable',
      nextAttemptAt: 'invalid',
    }, NOW);
    assert.equal(result.requiresMigration, true);
    assert.equal(result.nextAttemptAt, NOW);
  });

  it('migra tentativa legada exaurida diretamente para revisão manual', () => {
    assert.deepEqual(resolveVideoCleanupJobScheduling({
      attempts: 8,
    }, NOW), {
      state: 'dead_letter',
      nextAttemptAt: null,
      requiresMigration: true,
    });
  });

  it('não reativa dead letter já consolidada', () => {
    assert.deepEqual(resolveVideoCleanupJobScheduling({
      attempts: 8,
      state: 'dead_letter',
      nextAttemptAt: null,
    }, NOW), {
      state: 'dead_letter',
      nextAttemptAt: null,
      requiresMigration: false,
    });
  });
});
