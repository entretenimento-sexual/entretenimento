import assert from 'node:assert/strict';
import test from 'node:test';
import { probeFunctionsCallableWithRetry } from '../dev/functions-emulator-health.mjs';

const transport = { ready: false, status: 0 };
const ready = { ready: true, status: 204 };
async function run(results) {
  let calls = 0;
  let delays = 0;
  const options = { name: 'acceptAdultSelfDeclaration' };
  const result = await probeFunctionsCallableWithRetry(options, {
    probe: async input => {
      assert.equal(input, options);
      return results[calls++];
    },
    sleep: async ms => { assert.equal(ms, 500); delays++; },
  });
  return { result, calls, delays };
}
test('recovers after transient transport failure', async () => {
  assert.deepEqual(await run([transport, ready]), { result: ready, calls: 2, delays: 1 });
});
test('bounds repeated transport failure', async () => {
  assert.deepEqual(await run([transport, transport, transport]), { result: transport, calls: 3, delays: 2 });
});
test('successful probe does not retry', async () => {
  assert.deepEqual(await run([ready]), { result: ready, calls: 1, delays: 0 });
});
for (const status of [204, 403, 404, 500]) {
  test('does not bypass explicit HTTP or CORS failure: ' + status, async () => {
    const failure = { ready: false, status };
    assert.deepEqual(await run([failure, ready]), { result: failure, calls: 1, delays: 0 });
  });
}
