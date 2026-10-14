import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError, type AxiosResponse } from 'axios';

import { deleteVideoTranscoderJobWithTransport } from './video-transcoder-delete.transport';

const NAME = 'projects/demo/locations/us-central1/jobs/test-job';

function providerHttpError(status: number): AxiosError {
  return new AxiosError(
    'HTTP ' + status, 'ERR_BAD_RESPONSE', undefined, undefined,
    { status } as AxiosResponse
  );
}

test('200 deletion calls the injected transport exactly once', async () => {
  const seen: string[] = [];
  await deleteVideoTranscoderJobWithTransport(NAME, async (name) => {
    seen.push(name);
  });
  assert.deepEqual(seen, [NAME]);
});

test('404 from the injected provider is idempotent success', async () => {
  let attempts = 0;
  await deleteVideoTranscoderJobWithTransport(NAME, async () => {
    attempts += 1;
    throw providerHttpError(404);
  });
  assert.equal(attempts, 1);
});

test('503 and connection failures propagate; no storage cleanup implied', async () => {
  await assert.rejects(
    deleteVideoTranscoderJobWithTransport(NAME, async () => {
      throw providerHttpError(503);
    }),
    /HTTP 503/
  );
  await assert.rejects(
    deleteVideoTranscoderJobWithTransport(NAME, async () => {
      throw new Error('ECONNRESET');
    }),
    /ECONNRESET/
  );
});

test('invalid provider identity fails before any request', async () => {
  let requests = 0;
  await assert.rejects(
    deleteVideoTranscoderJobWithTransport(
      'projects/demo/jobs/invalid', async () => { requests += 1; }
    ),
    /Identificador do job/
  );
  assert.equal(requests, 0);
});
