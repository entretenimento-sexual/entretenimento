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

    assert.ok(reaction.globalMaxPerWindow > reaction.resourceMaxPerWindow);
    assert.ok(report.windowMs > reaction.windowMs);
    assert.ok(
      moderation.globalMaxPerWindow > reaction.globalMaxPerWindow
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

  it('reinicia a janela expirada', () => {
    const decision = buildMediaCallableRateDecision({
      now: 80_000,
      state: {
        windowStartedAt: 10_000,
        count: 99,
        lastAcceptedAt: 20_000,
      },
      maxPerWindow: 3,
      windowMs: 60_000,
      minIntervalMs: 1_000,
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.nextState, {
      windowStartedAt: 80_000,
      count: 1,
      lastAcceptedAt: 80_000,
    });
  });
});
