import {
  buildCallableCooldownState,
  isCallableResourceExhausted,
  resolveCallableRetryAfterMs,
} from './callable-cooldown.policy';

describe('callable-cooldown.policy', () => {
  it('reconhece o código normalizado das Functions', () => {
    expect(isCallableResourceExhausted({
      code: 'functions/resource-exhausted',
    })).toBe(true);
    expect(isCallableResourceExhausted({
      original: { code: 'resource-exhausted' },
    })).toBe(true);
    expect(isCallableResourceExhausted({
      code: 'functions/permission-denied',
    })).toBe(false);
  });

  it('lê retryAfterMs em detalhes aninhados', () => {
    expect(resolveCallableRetryAfterMs({
      code: 'functions/resource-exhausted',
      details: { retryAfterMs: 12_345 },
    })).toBe(12_345);

    expect(resolveCallableRetryAfterMs({
      original: {
        code: 'resource-exhausted',
        customData: {
          details: { retryAfterMs: 8_000 },
        },
      },
    })).toBe(8_000);
  });

  it('aplica limites seguros ao retry', () => {
    expect(resolveCallableRetryAfterMs({
      details: { retryAfterMs: 10 },
    })).toBe(1_000);
    expect(resolveCallableRetryAfterMs({
      details: { retryAfterMs: 99_999_999 },
    })).toBe(10 * 60 * 1_000);
  });

  it('produz contagem regressiva acessível', () => {
    expect(buildCallableCooldownState('admin', 15_500, 10_000)).toEqual({
      scope: 'admin',
      active: true,
      expiresAt: 15_500,
      remainingMs: 5_500,
      remainingSeconds: 6,
    });

    expect(buildCallableCooldownState('admin', 9_000, 10_000).active)
      .toBe(false);
  });
});
