import assert from 'node:assert/strict';
import test from 'node:test';
import { runBoundedRevocationCases } from
  './media-transaction-revocation-concurrency.mjs';

test('runs independent revocation cases with a fixed concurrency ceiling', async () => {
  let active = 0;
  let peak = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const observed = [];
  const pending = runBoundedRevocationCases(
    Array.from({ length: 9 }, (_, index) => index),
    async (index) => {
      active += 1;
      peak = Math.max(peak, active);
      await barrier;
      observed.push(index);
      active -= 1;
    },
    3
  );
  assert.equal(peak, 3);
  release();
  await pending;
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(observed.sort((a, b) => a - b),
    Array.from({ length: 9 }, (_, index) => index));
});

test('waits for all in-flight cases and propagates errors without skipping later cases', async () => {
  const observed = [];
  await assert.rejects(
    runBoundedRevocationCases([0, 1, 2, 3, 4], async (caseIndex) => {
      observed.push(caseIndex);
      if (caseIndex === 1 || caseIndex === 4) {
        throw new Error('case failed');
      }
    }, 2),
    (error) => error instanceof AggregateError && error.errors.length === 2
  );
  assert.deepEqual(observed.sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

test('rejects invalid concurrency and never silently excludes scenarios', async () => {
  await assert.rejects(runBoundedRevocationCases([0], async () => {}, 0),
    TypeError);
  await assert.rejects(runBoundedRevocationCases([0], async () => {}, 9),
    TypeError);
  let runs = 0;
  await runBoundedRevocationCases([0, 1], async () => { runs += 1; }, 8);
  assert.equal(runs, 2);
});
