import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BackendRateLimitQueue, BackendRateLimitQueueBusyError } from './backend-rate-limit-queue';
import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe('backend rate-limit local serialization', () => {
  it('serializa o mesmo documento e contabiliza cada custo sem compartilhar permissões', async () => {
    const queue = new BackendRateLimitQueue();
    const config = { burstWindowMs: 60_000, burstMax: 3, sustainedWindowMs: 600_000, sustainedMax: 5 };
    let state: BackendFixedWindowRateLimitState | null = null;
    let active = 0;
    let peak = 0;
    let attempts = 0;
    const consume = (cost: number) => queue.run('action:subject', async () => {
      attempts++;
      peak = Math.max(peak, ++active);
      try {
        const decision = buildBackendFixedWindowRateLimitDecision({ now: 100_000, state, cost, config });
        await Promise.resolve();
        if (!decision.allowed) throw new Error('resource-exhausted');
        state = decision.nextState;
      } finally {
        active--;
      }
    });
    const results = await Promise.allSettled([consume(2), consume(1), consume(1)]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected']);
    assert.equal(peak, 1);
    assert.equal(attempts, 3);
    assert.equal((state as BackendFixedWindowRateLimitState | null)?.burstCount, 3);
    assert.equal((state as BackendFixedWindowRateLimitState | null)?.sustainedCount, 3);
  });

  it('não bloqueia outra chave e libera a fila quando uma transação falha', async () => {
    const queue = new BackendRateLimitQueue();
    const gate = deferred();
    const first = queue.run('a', async () => {
      await gate.promise;
      throw new Error('transaction failed');
    });
    const failure = assert.rejects(first, /transaction failed/);
    let nextStarted = false;
    const next = queue.run('a', async () => { nextStarted = true; return 'next'; });
    assert.equal(await queue.run('b', async () => 'independent'), 'independent');
    assert.equal(nextStarted, false);
    gate.release();
    await failure;
    assert.equal(await next, 'next');
  });

  it('rejeita saturação por chave e global sem executar trabalho excedente', async () => {
    const queue = new BackendRateLimitQueue(1, 1);
    const gate = deferred();
    let unexpected = 0;
    const first = queue.run('a', () => gate.promise);
    const waiting = queue.run('a', async () => 'waiting');
    const work = async () => { unexpected++; };
    await assert.rejects(queue.run('a', work), BackendRateLimitQueueBusyError);
    await assert.rejects(queue.run('b', work), BackendRateLimitQueueBusyError);
    gate.release();
    await first;
    assert.equal(await waiting, 'waiting');
    assert.equal(unexpected, 0);
    // The finally handler releases the lane after settling the caller.
    await Promise.resolve();
    assert.equal(await queue.run('b', async () => 'released'), 'released');
  });

  it('expira apenas espera, nunca abandona uma transação ativa', async () => {
    const queue = new BackendRateLimitQueue(2, 2, 10);
    const gate = deferred();
    let expiredStarted = false;
    const first = queue.run('a', () => gate.promise);
    const expired = queue.run('a', async () => { expiredStarted = true; });
    await assert.rejects(expired, BackendRateLimitQueueBusyError);
    const next = queue.run('a', async () => 'next');
    gate.release();
    await first;
    assert.equal(await next, 'next');
    assert.equal(expiredStarted, false);
  });
});
