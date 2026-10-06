import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBackendFixedWindowRateLimitDecision,
} from './backend-fixed-window-rate-limit';

const CONFIG = {
  burstWindowMs: 60_000,
  burstMax: 3,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 5,
};

describe('backend fixed-window rate limit', () => {
  it('aceita até a capacidade e bloqueia o próximo consumo ponderado', () => {
    const first = buildBackendFixedWindowRateLimitDecision({
      now: 100_000,
      cost: 2,
      config: CONFIG,
    });

    assert.equal(first.allowed, true);

    const second = buildBackendFixedWindowRateLimitDecision({
      now: 100_100,
      state: first.nextState,
      cost: 1,
      config: CONFIG,
    });

    assert.equal(second.allowed, true);

    const blocked = buildBackendFixedWindowRateLimitDecision({
      now: 100_200,
      state: second.nextState,
      cost: 1,
      config: CONFIG,
    });

    assert.equal(blocked.allowed, false);
    assert.equal(blocked.nextState.burstCount, 3);
  });

  it('não reabre quota quando outra instância possui relógio ligeiramente atrasado', () => {
    const first = buildBackendFixedWindowRateLimitDecision({
      now: 200_000,
      cost: 3,
      config: CONFIG,
    });

    assert.equal(first.allowed, true);

    const skewed = buildBackendFixedWindowRateLimitDecision({
      now: 199_500,
      state: first.nextState,
      cost: 1,
      config: CONFIG,
    });

    assert.equal(skewed.allowed, false);
    assert.equal(skewed.nextState.burstWindowStartedAt, 200_000);
    assert.equal(skewed.nextState.burstCount, 3);
    assert.equal(skewed.retryAfterMs, CONFIG.burstWindowMs);
  });

  it('mantém a janela sustentada mesmo depois da renovação da janela curta', () => {
    const first = buildBackendFixedWindowRateLimitDecision({
      now: 300_000,
      cost: 3,
      config: CONFIG,
    });
    const second = buildBackendFixedWindowRateLimitDecision({
      now: 361_000,
      state: first.nextState,
      cost: 2,
      config: CONFIG,
    });

    assert.equal(second.allowed, true);
    assert.equal(second.nextState.burstCount, 2);
    assert.equal(second.nextState.sustainedCount, 5);

    const blocked = buildBackendFixedWindowRateLimitDecision({
      now: 422_000,
      state: second.nextState,
      cost: 1,
      config: CONFIG,
    });

    assert.equal(blocked.allowed, false);
    assert.equal(blocked.nextState.sustainedCount, 5);
  });

  it('renova as duas janelas quando elas realmente expiram', () => {
    const first = buildBackendFixedWindowRateLimitDecision({
      now: 400_000,
      cost: 3,
      config: CONFIG,
    });

    const renewed = buildBackendFixedWindowRateLimitDecision({
      now: 1_001_000,
      state: first.nextState,
      cost: 1,
      config: CONFIG,
    });

    assert.equal(renewed.allowed, true);
    assert.equal(renewed.nextState.burstCount, 1);
    assert.equal(renewed.nextState.sustainedCount, 1);
    assert.equal(renewed.nextState.burstWindowStartedAt, 1_001_000);
    assert.equal(renewed.nextState.sustainedWindowStartedAt, 1_001_000);
  });
});
