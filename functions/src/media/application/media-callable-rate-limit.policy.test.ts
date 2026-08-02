import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMediaCallableRateDecision,
  resolveMediaCallableRateLimitRule,
} from './media-callable-rate-limit.policy';

describe('media-callable-rate-limit.policy', () => {
  it('compartilha regras equilibradas por categoria', () => {
    const reaction = resolveMediaCallableRateLimitRule('REACTION');
    const report = resolveMediaCallableRateLimitRule('REPORT');
    const moderation = resolveMediaCallableRateLimitRule(
      'COMMENT_MODERATE'
    );
    const publicAccess = resolveMediaCallableRateLimitRule('ACCESS_PUBLIC');
    const privateAccess = resolveMediaCallableRateLimitRule('ACCESS_PRIVATE');
    const listPublic = resolveMediaCallableRateLimitRule('LIST_PUBLIC');
    const upload = resolveMediaCallableRateLimitRule('UPLOAD_REGISTER');
    const publish = resolveMediaCallableRateLimitRule('MEDIA_PUBLISH');
    const deletion = resolveMediaCallableRateLimitRule('MEDIA_DELETE');
    const adminStatus = resolveMediaCallableRateLimitRule('ADMIN_STATUS');
    const adminQueue = resolveMediaCallableRateLimitRule('ADMIN_QUEUE');
    const adminModeration = resolveMediaCallableRateLimitRule(
      'ADMIN_MODERATION'
    );
    const adminRecovery = resolveMediaCallableRateLimitRule(
      'ADMIN_PROCESSING_RECOVERY'
    );

    assert.ok(reaction.globalMaxPerWindow > reaction.resourceMaxPerWindow);
    assert.ok(report.windowMs > reaction.windowMs);
    assert.ok(
      moderation.globalMaxPerWindow > reaction.globalMaxPerWindow
    );
    assert.ok(
      privateAccess.globalMaxPerWindow > publicAccess.globalMaxPerWindow
    );
    assert.ok(
      listPublic.globalMaxPerWindow > publicAccess.globalMaxPerWindow
    );
    assert.equal(upload.windowMs, report.windowMs);
    assert.equal(deletion.windowMs, report.windowMs);
    assert.ok(upload.globalMaxPerWindow > publish.globalMaxPerWindow);
    assert.equal(adminStatus.globalMaxPerWindow, adminStatus.resourceMaxPerWindow);
    assert.ok(adminStatus.minIntervalMs > adminModeration.minIntervalMs);
    assert.ok(adminQueue.globalMaxPerWindow > adminQueue.resourceMaxPerWindow);
    assert.ok(
      adminModeration.globalMaxPerWindow > adminRecovery.globalMaxPerWindow
    );
    assert.ok(
      adminRecovery.resourceMaxPerWindow < adminModeration.resourceMaxPerWindow
    );
  });

  it('aceita a primeira operação e incrementa o estado', () => {
    const decision = buildMediaCallableRateDecision({
      now: 10_000,
      state: null,
      maxPerWindow: 3,
      windowMs: 60_000,
      minIntervalMs: 1_000,
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.nextState, {
      windowStartedAt: 10_000,
      count: 1,
      lastAcceptedAt: 10_000,
    });
  });

  it('cobra operações em lote pelo número de itens', () => {
    const decision = buildMediaCallableRateDecision({
      now: 10_000,
      state: null,
      maxPerWindow: 100,
      windowMs: 60_000,
      minIntervalMs: 0,
      cost: 32,
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.nextState.count, 32);
  });

  it('bloqueia um lote que ultrapassaria o saldo da janela', () => {
    const decision = buildMediaCallableRateDecision({
      now: 20_000,
      state: {
        windowStartedAt: 10_000,
        count: 90,
        lastAcceptedAt: 10_000,
      },
      maxPerWindow: 100,
      windowMs: 60_000,
      minIntervalMs: 0,
      cost: 16,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.retryAfterMs, 50_000);
    assert.equal(decision.nextState.count, 90);
  });

  it('bloqueia rajadas até cumprir o intervalo mínimo', () => {
    const decision = buildMediaCallableRateDecision({
      now: 10_500,
      state: {
        windowStartedAt: 10_000,
        count: 1,
        lastAcceptedAt: 10_000,
      },
      maxPerWindow: 3,
      windowMs: 60_000,
      minIntervalMs: 1_000,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.retryAfterMs, 1_000);
    assert.equal(decision.nextState.count, 1);
  });

  it('bloqueia ao atingir o teto e informa a janela restante', () => {
    const decision = buildMediaCallableRateDecision({
      now: 30_000,
      state: {
        windowStartedAt: 10_000,
        count: 3,
        lastAcceptedAt: 20_000,
      },
      maxPerWindow: 3,
      windowMs: 60_000,
      minIntervalMs: 500,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.retryAfterMs, 40_000);
  });

  it('reinicia a janela expirada e aplica o custo atual', () => {
    const decision = buildMediaCallableRateDecision({
      now: 80_000,
      state: {
        windowStartedAt: 10_000,
        count: 99,
        lastAcceptedAt: 20_000,
      },
      maxPerWindow: 20,
      windowMs: 60_000,
      minIntervalMs: 1_000,
      cost: 12,
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.nextState, {
      windowStartedAt: 80_000,
      count: 12,
      lastAcceptedAt: 80_000,
    });
  });
});
